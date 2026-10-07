import { Command, CommandContribution, CommandRegistry, nls } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, NavigatableWidget, Widget, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { LocationMapperService } from '@theia/mini-browser/lib/browser/location-mapper-service';
import { MiniBrowserCommands, MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
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

	@inject(LocationMapperService)
	protected readonly locationMapperService!: LocationMapperService;

	onStart(): void {
		this.shell.onDidAddWidget(widget => {
			// A preview that is already grouped is being moved by Theia; the service puts it back.
			if (!this.isMarkdownPreview(widget) || this.groupTabsService.getPair(widget)) {
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

	async onDidInitializeLayout(): Promise<void> {
		await this.groupTabsService.adoptRestored();
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

		// Same props as MiniBrowserOpenHandler.openPreview, which always opens in (and widens) the right side panel.
		// Mini Browser widgets are keyed by URI and every preview shares PREVIEW_URI, so a per source query keeps
		// this preview from taking over Open URL's widget or another group's preview.
		const previewUri = MiniBrowserOpenHandler.PREVIEW_URI.withQuery(`group-tabs=${active.id}`);
		const preview = await this.miniBrowserOpenHandler.open(previewUri, {
			name: nls.localize(MiniBrowserCommands.PREVIEW_CATEGORY_KEY, MiniBrowserCommands.PREVIEW_CATEGORY),
			startPage: await this.locationMapperService.map(url),
			toolbar: 'read-only',
			resetBackground: true,
			iconClass: codicon('preview'),
			openFor: 'preview',
			mode: 'reveal',
			widgetOptions: { area: 'main', ref: active, mode: 'tab-after' }
		});
		// The preview server does not survive a reload, so a restored group falls back to the source.
		await this.groupTabsService.pair(active, preview, { restoreSecondary: false });
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
