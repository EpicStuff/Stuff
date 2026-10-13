import { ApplicationShell, FrontendApplicationContribution, OpenerService, open } from '@theia/core/lib/browser';
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

	async getWindowId(): Promise<number> {
		const electronWindow = window as Window & typeof globalThis & {
			electronTheiaCore: {
				WindowMetadata: {
					webcontentId: string;
				};
			};
		};
		return Number(electronWindow.electronTheiaCore.WindowMetadata.webcontentId);
	}

	async getWorkspacePath(): Promise<string | undefined> {
		return this.workspaceService.workspace?.resource.path.fsPath();
	}

	async openWorkspace(workspacePath: string): Promise<void> {
		window.location.hash = encodeURI(workspacePath);
		this.windowService.reload();
	}

	async openFile(filePath: string, line?: number, column?: number): Promise<void> {
		const selection = line === undefined ? undefined : {
			start: {
				line: line - 1,
				character: (column ?? 1) - 1
			}
		};
		await open(this.openerService, FileUri.create(filePath), selection ? { selection } : undefined);
	}

	async openFileAndWait(filePath: string, line?: number, column?: number): Promise<void> {
		const selection = line === undefined ? undefined : {
			start: {
				line: line - 1,
				character: (column ?? 1) - 1
			}
		};
		const uri = FileUri.create(filePath);
		const widget = await open(this.openerService, uri, selection ? { selection } : undefined);
		await this.waitForEditorClose(widget, uri.toString());
	}

	async openFilesAndWait(filePaths: string[]): Promise<void> {
		const waits: Promise<void>[] = [];
		for (const filePath of filePaths) {
			const uri = FileUri.create(filePath);
			const widget = await open(this.openerService, uri);
			waits.push(this.waitForEditorClose(widget, uri.toString()));
		}
		await Promise.all(waits);
	}

	async openDiff(leftPath: string, rightPath: string): Promise<void> {
		const uri = DiffUris.encode(FileUri.create(leftPath), FileUri.create(rightPath));
		await open(this.openerService, uri);
	}
	async openDiffAndWait(leftPath: string, rightPath: string): Promise<void> {
		const uri = DiffUris.encode(FileUri.create(leftPath), FileUri.create(rightPath));
		const widget = await open(this.openerService, uri);
		await this.waitForEditorClose(widget, uri.toString());
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
