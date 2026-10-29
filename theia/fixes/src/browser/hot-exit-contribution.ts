import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { HotExitBackup, HotExitBackupService } from '../common/hot-exit-protocol';
import { decideHotExitRecovery, selectHotExitBackups } from './hot-exit-state';

@injectable()
export class HotExitContribution implements FrontendApplicationContribution {
	@inject(HotExitBackupService)
	protected readonly backupService!: HotExitBackupService;

	@inject(MonacoTextModelService)
	protected readonly modelService!: MonacoTextModelService;

	@inject(EditorManager)
	protected readonly editorManager!: EditorManager;

	@inject(FrontendApplicationStateService)
	protected readonly appState!: FrontendApplicationStateService;

	@inject(MessageService)
	protected readonly messages!: MessageService;

	@inject(WindowService)
	protected readonly windowService!: WindowService;

	private readonly models = new Map<string, { model: MonacoEditorModel; baseContent: string }>();
	private readonly backups = new Map<string, HotExitBackup>();
	private readonly recovered = new Map<string, HotExitBackup>();
	private readonly conflicts = new Set<string>();
	private windowId = 0;
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly writes = new Map<string, Promise<void>>();
	private shuttingDown = false;
	private workspace = '';

	async onStart(): Promise<void> {
		this.workspace = decodeURI(window.location.hash.slice(1));
		this.windowId = Number((window as Window & { electronTheiaCore: { WindowMetadata: { webcontentId: string } } }).electronTheiaCore.WindowMetadata.webcontentId);
		const saved = await this.backupService.list(this.workspace, this.windowId);
		const { selected, conflicts } = selectHotExitBackups(saved);
		for (const [uri, backup] of selected) {
			this.backups.set(uri, backup);
		}
		for (const uri of conflicts) {
			this.conflicts.add(uri);
			this.messages.warn('Multiple Hot Exit versions exist for ' + uri + '. The backups are preserved for manual recovery.');
		}
		const service = this.windowService as WindowService & { isSafeToShutDown(reason: unknown): Promise<boolean> };
		const original = service.isSafeToShutDown.bind(service);
		service.isSafeToShutDown = async reason => {
			const allowed = await original(reason);
			return allowed && (!this.hasPendingWork() || await this.prepareToExit());
		};
		this.modelService.onDidCreate(model => this.track(model));
		for (const model of this.modelService.models) {
			this.track(model);
		}
		void this.appState.reachedState('ready').then(() => this.reopenBackedUpEditors()).catch(error => {
			console.error('Unable to reopen Hot Exit editors:', error);
		});
	}

	hasPendingWork(): boolean {
		return this.timers.size > 0 || this.writes.size > 0 || [...this.models.values()].some(entry => entry.model.dirty);
	}

	canBackUpDirtyEditors(widgets: readonly EditorWidget[]): boolean {
		return widgets.length > 0 && widgets.every(widget =>
			widget.editor instanceof MonacoEditor &&
			this.models.get(widget.editor.document.uri)?.model === widget.editor.document
		);
	}

	async prepareToExit(): Promise<boolean> {
		try {
			for (const timer of this.timers.values()) {
				clearTimeout(timer);
			}
			this.timers.clear();
			const tasks: Promise<void>[] = [];
			for (const [uri, entry] of this.models) {
				if (entry.model.dirty) {
					tasks.push(this.enqueueWrite(uri, entry));
				}
			}
			await Promise.all(tasks);
			await Promise.all(this.writes.values());
			return true;
		} catch (error) {
			this.messages.error('Hot Exit could not back up unsaved changes. Restart or exit cancelled.');
			console.error('Hot Exit backup failed:', error);
			return false;
		}
	}

	onStop(): void {
		this.shuttingDown = true;
	}

	private track(model: MonacoEditorModel): void {
		const uri = model.uri;
		if (this.models.has(uri) || !['file', 'untitled'].includes(new URI(uri).scheme)) {
			return;
		}
		const baseContent = model.textEditorModel.getValue();
		const entry = { model, baseContent };
		this.models.set(uri, entry);

		model.onDidChangeContent(() => {
			if (model.dirty) {
				this.scheduleWrite(uri, entry);
			}
		});
		model.onDirtyChanged(() => {
			if (!model.dirty && !this.shuttingDown) {
				entry.baseContent = model.textEditorModel.getValue();
				this.cancelTimer(uri);
				this.backups.delete(uri);
				this.queue(uri, async () => {
					await this.backupService.remove(this.workspace, uri, this.windowId);
					await this.discardRecovered(uri);
				});
			}
		});
		model.onWillDispose(() => {
			if (this.models.get(uri) === entry) {
				this.models.delete(uri);
			}
			this.cancelTimer(uri);
			if (!this.shuttingDown && !model.dirty) {
				this.backups.delete(uri);
				this.queue(uri, async () => {
					await this.backupService.remove(this.workspace, uri, this.windowId);
					await this.discardRecovered(uri);
				});
			}
		});

		const backup = this.backups.get(uri);
		if (backup) {
			const decision = decideHotExitRecovery(backup, baseContent, model.dirty);
			if (decision === 'restore') {
				this.recovered.set(uri, backup);
				model.textEditorModel.setValue(backup.content);
				this.scheduleWrite(uri, entry);
			} else if (decision === 'unchanged') {
				this.backups.delete(uri);
				this.queue(uri, async () => {
					await this.backupService.remove(this.workspace, uri, this.windowId);
					await this.backupService.removeRecovered(backup, this.windowId);
				});
			} else if (decision === 'conflict') {
				this.conflicts.add(uri);
				this.messages.warn('Hot Exit backup not applied because the file changed: ' + uri);
			}
		} else if (model.dirty) {
			this.scheduleWrite(uri, entry);
		}
	}

	private async reopenBackedUpEditors(): Promise<void> {
		for (const backup of this.backups.values()) {
			if (!this.models.has(backup.uri)) {
				try {
					await this.editorManager.open(new URI(backup.uri), { mode: 'open' });
				} catch (error) {
					console.warn('Unable to reopen Hot Exit editor:', backup.uri, error);
				}
			}
		}
	}

	private scheduleWrite(uri: string, entry: { model: MonacoEditorModel; baseContent: string }): void {
		this.cancelTimer(uri);
		this.timers.set(uri, setTimeout(() => {
			this.timers.delete(uri);
			if (entry.model.dirty) {
				void this.enqueueWrite(uri, entry).catch(error => console.error('Hot Exit backup failed:', error));
			}
		}, 250));
	}

	private cancelTimer(uri: string): void {
		const timer = this.timers.get(uri);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.timers.delete(uri);
		}
	}

	private enqueueWrite(uri: string, entry: { model: MonacoEditorModel; baseContent: string }): Promise<void> {
		const backup: HotExitBackup = { workspace: this.workspace, uri, baseContent: entry.baseContent, content: entry.model.textEditorModel.getValue() };
		this.backups.set(uri, backup);
		return this.queue(uri, async () => {
			await this.backupService.write(backup, this.windowId);
			await this.discardRecovered(uri);
		});
	}

	private async discardRecovered(uri: string): Promise<void> {
		const backup = this.recovered.get(uri);
		if (backup) {
			await this.backupService.removeRecovered(backup, this.windowId);
			this.recovered.delete(uri);
		}
	}

	private queue(uri: string, operation: () => Promise<void>): Promise<void> {
		const pending = (this.writes.get(uri) ?? Promise.resolve()).catch(() => undefined).then(operation);
		this.writes.set(uri, pending);
		void pending.finally(() => {
			if (this.writes.get(uri) === pending) {
				this.writes.delete(uri);
			}
		}).catch(() => undefined);
		return pending;
	}
}
