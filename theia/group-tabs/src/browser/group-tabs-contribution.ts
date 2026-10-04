import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, NavigatableWidget, Widget, codicon } from '@theia/core/lib/browser';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { GroupTabsService } from './group-tabs-service';

export namespace GroupTabsCommands {
	export const GROUP: Command = {
		id: 'group-tabs.group',
		label: 'Group Tabs'
	};

	export const CLOSE_SECONDARY: Command = {
		id: 'group-tabs.closeSecondary',
		label: 'Close Grouped Pane'
	};
}

interface WidgetPick extends QuickPickItem {
	widget: Widget;
}

@injectable()
export class GroupTabsContribution implements FrontendApplicationContribution, CommandContribution, TabBarToolbarContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(GroupTabsService)
	protected readonly groupTabsService!: GroupTabsService;

	@inject(MiniBrowserOpenHandler)
	protected readonly miniBrowserOpenHandler!: MiniBrowserOpenHandler;

	@inject(QuickInputService)
	protected readonly quickInputService!: QuickInputService;

	async onStart(): Promise<void> {
		await this.groupTabsService.start();
		this.patchMiniBrowserUrlPreview();
	}

	async onDidInitializeLayout(): Promise<void> {
		await this.groupTabsService.adoptRestored();
	}

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(GroupTabsCommands.GROUP, {
			execute: () => this.groupTabs(),
			isEnabled: () => {
				const primary = this.groupTabsService.resolveSource(this.shell.activeWidget ?? this.shell.currentWidget);
				return !!primary && this.groupTabsService.getGroupableWidgets(primary).length > 0;
			}
		});

		commands.registerCommand(GroupTabsCommands.CLOSE_SECONDARY, {
			execute: (widget?: Widget) => this.groupTabsService.closeSecondary(widget ?? this.shell.activeWidget),
			isEnabled: (widget?: Widget) => this.groupTabsService.getMembers(widget ?? this.shell.activeWidget).length > 1,
			isVisible: (widget?: Widget) => this.groupTabsService.getMembers(widget ?? this.shell.activeWidget).length > 1
		});
	}

	registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
		toolbar.registerItem({
			id: GroupTabsCommands.CLOSE_SECONDARY.id,
			command: GroupTabsCommands.CLOSE_SECONDARY.id,
			icon: codicon('close'),
			tooltip: 'Close Grouped Pane',
			priority: 100,
			isVisible: widget => this.groupTabsService.getMembers(widget).length > 1
		});
	}

	protected async groupTabs(): Promise<void> {
		const primary = this.groupTabsService.resolveSource(this.shell.activeWidget ?? this.shell.currentWidget);
		if (!primary || primary.isDisposed) {
			return;
		}

		const candidates = this.groupTabsService.getGroupableWidgets(primary);
		if (candidates.length === 0) {
			return;
		}

		const picks: WidgetPick[] = candidates.map(widget => {
			const uri = NavigatableWidget.getUri(widget);
			return {
				label: widget.title.label || widget.id,
				description: uri?.toString(),
				widget
			};
		});
		const selected = await this.quickInputService.pick(picks, {
			canPickMany: true,
			placeHolder: 'Select tabs to group'
		});
		if (!selected?.length) {
			return;
		}

		await this.groupTabsService.groupManual(primary, selected.map(item => item.widget));
	}

	protected patchMiniBrowserUrlPreview(): void {
		const original = this.miniBrowserOpenHandler.openPreview.bind(this.miniBrowserOpenHandler);
		this.miniBrowserOpenHandler.openPreview = async startPage => {
			const source = this.groupTabsService.resolveSource(this.shell.activeWidget ?? this.shell.currentWidget);
			const preview = await original(startPage);
			this.groupTabsService.noteMiniBrowserUrlPreview(preview, source);
			return preview;
		};
	}
}
