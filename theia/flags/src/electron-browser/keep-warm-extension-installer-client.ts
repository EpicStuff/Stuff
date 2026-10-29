import { ApplicationShell, FrontendApplicationContribution, OpenerService, open } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';
import { WaitEditor, waitForEditorResourcesClosed } from './wait-for-editors';
import { whenFrontendReady } from './when-frontend-ready';

@injectable()
export class KeepWarmExtensionInstallerClientImpl implements KeepWarmExtensionInstallerClient {
	@inject(OpenerService)
	protected readonly openerService!: OpenerService;

	@inject(WindowService)
	protected readonly windowService!: WindowService;

	@inject(WorkspaceService)
	protected readonly workspaceService!: WorkspaceService;

	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(FrontendApplicationStateService)
	protected readonly frontendState!: FrontendApplicationStateService;

	async getWindowId(): Promise<number> {
		// The main process uses this call as the frontend registration handshake.
		// Do not register a new window until the editor layout has been initialized
		// and restored, otherwise early CLI opens can be overwritten at startup.
		return whenFrontendReady(this.frontendState, () => {
			const electronWindow = window as Window & typeof globalThis & {
				electronTheiaCore: {
					WindowMetadata: {
						webcontentId: string;
					};
				};
			};
			return Number(electronWindow.electronTheiaCore.WindowMetadata.webcontentId);
		});
	}

	async getWorkspacePath(): Promise<string | undefined> {
		return this.workspaceService.workspace?.resource.path.fsPath();
	}

	async openWorkspace(workspacePath: string): Promise<void> {
		window.location.hash = encodeURI(workspacePath);
		this.windowService.reload();
	}

	async openFile(filePath: string, line?: number, column?: number, exists = true): Promise<void> {
		const selection = line === undefined ? undefined : {
			start: {
				line: line - 1,
				character: (column ?? 1) - 1
			}
		};
		const uri = exists ? FileUri.create(filePath) : FileUri.create(filePath).withScheme('untitled');
		await open(this.openerService, uri, selection ? { selection } : undefined);
	}

	async openFileAndWait(filePath: string, line?: number, column?: number, exists = true): Promise<void> {
		const selection = line === undefined ? undefined : {
			start: {
				line: line - 1,
				character: (column ?? 1) - 1
			}
		};
		const uri = exists ? FileUri.create(filePath) : FileUri.create(filePath).withScheme('untitled');
		const widget = await open(this.openerService, uri, selection ? { selection } : undefined);
		await this.waitForEditorClose(widget, uri.toString());
	}

	async openFilesAndWait(filePaths: string[], exists?: boolean[]): Promise<void> {
		const waits: Promise<void>[] = [];
		for (const [index, filePath] of filePaths.entries()) {
			const uri = exists?.[index] === false ? FileUri.create(filePath).withScheme('untitled') : FileUri.create(filePath);
			const widget = await open(this.openerService, uri);
			waits.push(this.waitForEditorClose(widget, uri.toString()));
		}
		await Promise.all(waits);
	}

	async openDiff(leftPath: string, rightPath: string, leftExists: boolean, rightExists: boolean): Promise<void> {
		const uri = this.createDiffUri(leftPath, rightPath, leftExists, rightExists);
		await open(this.openerService, uri);
	}

	async openDiffAndWait(leftPath: string, rightPath: string, leftExists: boolean, rightExists: boolean): Promise<void> {
		const uri = this.createDiffUri(leftPath, rightPath, leftExists, rightExists);
		const widget = await open(this.openerService, uri);
		await this.waitForEditorClose(widget, uri.toString());
	}

	protected createDiffUri(leftPath: string, rightPath: string, leftExists: boolean, rightExists: boolean) {
		const left = FileUri.create(leftPath);
		const right = FileUri.create(rightPath);
		// Use empty untitled models for missing files without creating files on disk.
		return DiffUris.encode(leftExists ? left : left.withScheme('untitled'), rightExists ? right : right.withScheme('untitled'));
	}

	protected waitForEditorClose(opened: object | undefined, resource: string): Promise<void> {
		if (!(opened instanceof Widget)) {
			throw new Error('Theia did not open an editor widget');
		}
		if (opened.isDisposed) {
			return Promise.resolve();
		}

		if (NavigatableWidget.getUri(opened)?.toString() !== resource) {
			// Some custom and diff editors expose no navigatable resource.
			// Their widget disposal is the only reliable close signal.
			return new Promise(resolve => {
				const onDisposed = (): void => {
					opened.disposed.disconnect(onDisposed);
					resolve();
				};
				opened.disposed.connect(onDisposed);
			});
		}

		const describe = (widget: Widget): WaitEditor => ({
			resource: NavigatableWidget.getUri(widget)?.toString() ?? '',
			saveable: Saveable.get(widget)
		});

		return waitForEditorResourcesClosed([resource], {
			getOpenEditors: () => this.shell.widgets.map(describe),
			onDidChangeEditors: listener => {
				const added = this.shell.onDidAddWidget(widget => listener(describe(widget)));
				const removed = this.shell.onDidRemoveWidget(widget => listener(describe(widget)));
				return {
					dispose: () => {
						added.dispose();
						removed.dispose();
					}
				};
			}
		});
	}
}

@injectable()
export class KeepWarmExtensionInstallerFrontendContribution implements FrontendApplicationContribution {
	@inject(KeepWarmExtensionInstallerService)
	protected readonly installerService!: KeepWarmExtensionInstallerService;

	onStart(): void {
		void this.installerService;
	}
}
