import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { ApplicationShell, DockLayout, DockPanel, FrontendApplicationContribution, Widget, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { GroupTabsService } from './group-tabs-service';
import { GroupTabsWidget } from './group-tabs-widget';

export namespace GroupTabsCommands {
	export const GROUP: Command = {
		id: 'group-tabs.group',
		label: 'Group Tabs'
	};

	export const CLOSE_SECONDARY: Command = {
		id: 'group-tabs.closeSecondary',
		label: 'Close Grouped Pane'
	};

	export const UNGROUP: Command = {
		id: 'group-tabs.ungroup',
		label: 'Ungroup Tabs'
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

		commands.registerCommand(GroupTabsCommands.UNGROUP, {
			execute: (widget?: Widget) => this.groupTabsService.ungroup(widget ?? this.shell.activeWidget ?? this.shell.currentWidget),
			isEnabled: (widget?: Widget) => !!this.groupTabsService.getPair(widget ?? this.shell.activeWidget ?? this.shell.currentWidget),
			isVisible: (widget?: Widget) => !!this.groupTabsService.getPair(widget ?? this.shell.activeWidget ?? this.shell.currentWidget)
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
		const layout = this.visibleMainLayout();
		if (!layout || this.layoutWidgetCount(layout.main) < 2) {
			return;
		}

		await this.groupTabsService.groupLayout(layout);
	}

	protected visibleMainLayout(): DockPanel.ILayoutConfig | undefined {
		const saved = this.shell.mainPanel.saveLayout();
		const main = this.visibleArea(saved.main);
		return main ? { main } : undefined;
	}

	protected visibleArea(area: DockLayout.AreaConfig | null): DockLayout.AreaConfig | null {
		if (!area) {
			return null;
		}
		if (area.type === 'tab-area') {
			const current = area.widgets[area.currentIndex];
			if (!current || current.isDisposed) {
				return null;
			}
			if (current instanceof GroupTabsWidget) {
				return current.getGroupLayout().main;
			}
			return {
				type: 'tab-area',
				widgets: [current],
				currentIndex: 0
			};
		}

		const children: DockLayout.AreaConfig[] = [];
		const sizes: number[] = [];
		for (let index = 0; index < area.children.length; index++) {
			const child = this.visibleArea(area.children[index]);
			if (child) {
				children.push(child);
				sizes.push(area.sizes[index] ?? 1);
			}
		}
		if (children.length === 0) {
			return null;
		}
		if (children.length === 1) {
			return children[0];
		}
		const total = sizes.reduce((sum, size) => sum + size, 0);
		return {
			type: 'split-area',
			orientation: area.orientation,
			children,
			sizes: total > 0 ? sizes.map(size => size / total) : sizes
		};
	}

	protected layoutWidgetCount(area: DockLayout.AreaConfig | null): number {
		if (!area) {
			return 0;
		}
		if (area.type === 'tab-area') {
			return area.widgets.length;
		}
		return area.children.reduce((count, child) => count + this.layoutWidgetCount(child), 0);
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
