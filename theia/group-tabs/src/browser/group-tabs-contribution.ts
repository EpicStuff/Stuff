import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, NavigatableWidget, Widget, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { GroupTabsService } from './group-tabs-service';

export namespace GroupTabsCommands {
	export const CLOSE_SECONDARY: Command = {
		id: 'group-tabs.closeSecondary',
		label: 'Close Preview'
	};

	export const OPEN_PREVIEW_URL: Command = {
		id: 'group-tabs.openPreviewUrl',
		label: 'Open Grouped Preview URL'
	};
}

@injectable()
export class GroupTabsContribution implements FrontendApplicationContribution, CommandContribution, TabBarToolbarContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(GroupTabsService)
	protected readonly groupTabsService!: GroupTabsService;

	@inject(MiniBrowserOpenHandler)
	protected readonly miniBrowserOpenHandler!: MiniBrowserOpenHandler;

	onStart(): void {
		this.shell.onDidAddWidget(widget => {
			if (!this.isMarkdownPreview(widget)) {
				return;
			}

			const primary = this.findMarkdownPrimary();
			if (!primary) {
				return;
			}

			setTimeout(() => {
				if (!primary.isDisposed && !widget.isDisposed) {
					void this.groupTabsService.pair(primary, widget).catch(error => console.error('Failed to group Markdown preview', error));
				}
			}, 0);
		});
	}

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(GroupTabsCommands.CLOSE_SECONDARY, {
			execute: (widget?: Widget) => this.groupTabsService.closeSecondary(widget ?? this.shell.activeWidget),
			isEnabled: (widget?: Widget) => !!this.groupTabsService.getPair(widget ?? this.shell.activeWidget),
			isVisible: (widget?: Widget) => !!this.groupTabsService.getPair(widget ?? this.shell.activeWidget)
		});

		commands.registerCommand(GroupTabsCommands.OPEN_PREVIEW_URL, {
			execute: async (url: string) => this.openGroupedPreviewUrl(url),
			isEnabled: (url: string) => typeof url === 'string' && url.length > 0
		});
	}

	registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
		toolbar.registerItem({
			id: GroupTabsCommands.CLOSE_SECONDARY.id,
			command: GroupTabsCommands.CLOSE_SECONDARY.id,
			icon: codicon('close'),
			tooltip: 'Close Preview',
			priority: 100,
			isVisible: widget => !!this.groupTabsService.getPair(widget)
		});
	}

	protected async openGroupedPreviewUrl(url: string): Promise<void> {
		if (typeof url !== 'string' || url.length === 0) {
			return;
		}

		const active = this.groupTabsService.getPrimary(this.shell.activeWidget ?? this.shell.currentWidget);
		if (!active || active.isDisposed) {
			throw new Error('No source widget is active for the preview');
		}

		const preview = await this.miniBrowserOpenHandler.openPreview(url);
		await this.groupTabsService.pair(active, preview);
	}

	protected findMarkdownPrimary(): Widget | undefined {
		for (const candidate of [this.shell.activeWidget, this.shell.currentWidget]) {
			const primary = this.groupTabsService.getPrimary(candidate);
			const uri = NavigatableWidget.getUri(primary);
			if (primary && uri && (uri.path.ext === '.md' || uri.path.ext === '.markdown')) {
				return primary;
			}
		}
		return undefined;
	}

	protected isMarkdownPreview(widget: Widget): widget is WebviewWidget {
		return widget instanceof WebviewWidget
			&& (widget.viewType === 'markdown.preview' || widget.viewType === 'vscode.markdown.preview.editor');
	}
}
