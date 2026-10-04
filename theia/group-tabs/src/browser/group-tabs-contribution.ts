import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, Widget, codicon } from '@theia/core/lib/browser';
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

@injectable()
export class GroupTabsContribution implements FrontendApplicationContribution, CommandContribution, TabBarToolbarContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(GroupTabsService)
	protected readonly groupTabsService!: GroupTabsService;

	@inject(MiniBrowserOpenHandler)
	protected readonly miniBrowserOpenHandler!: MiniBrowserOpenHandler;

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
			isEnabled: () => this.getCurrentTabs().length > 1
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
		const tabs = this.getCurrentTabs();
		if (tabs.length < 2) {
			return;
		}

		const active = this.groupTabsService.resolveSource(this.shell.activeWidget ?? this.shell.currentWidget);
		const primary = active && tabs.includes(active) ? active : tabs[0];
		await this.groupTabsService.groupManual(primary, tabs.filter(widget => widget !== primary));
	}

	protected getCurrentTabs(): Widget[] {
		const result: Widget[] = [];
		const seen = new Set<Widget>();
		const add = (widget: Widget | undefined): void => {
			if (!widget || widget.isDisposed) {
				return;
			}
			for (const member of this.groupTabsService.getMembers(widget)) {
				if (!member.isDisposed && !seen.has(member)) {
					seen.add(member);
					result.push(member);
				}
			}
		};

		for (const tabBar of this.shell.mainPanel.tabBars()) {
			add(tabBar.currentTitle?.owner);
		}

		const right = this.shell.getCurrentWidget('right');
		if (right?.isVisible && this.groupTabsService.isMiniBrowserUrlPreview(right)) {
			add(right);
		}

		return result;
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
