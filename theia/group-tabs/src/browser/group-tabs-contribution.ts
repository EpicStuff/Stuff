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
		const mainLayout = this.shell.mainPanel.saveLayout();
		const layout = this.toGroupLayout(mainLayout.main);
		if (!layout || this.layoutWidgetCount(layout) < 2) {
			return;
		}

		await this.groupTabsService.groupLayout(layout, mainLayout);
	}

	protected toGroupLayout(area: DockLayout.AreaConfig | null | undefined): GroupTabsWidget.LayoutNodeState | undefined {
		const child = this.toGroupChild(area);
		if (!child) {
			return undefined;
		}
		if ('widgets' in child) {
			return {
				orientation: 'horizontal',
				children: [child]
			};
		}
		return child;
	}

	protected toGroupChild(area: DockLayout.AreaConfig | null | undefined): GroupTabsWidget.LayoutChildState | undefined {
		if (!area) {
			return undefined;
		}
		if (area.type === 'tab-area') {
			const current = area.widgets[area.currentIndex];
			if (!current || current.isDisposed) {
				return undefined;
			}
			if (current instanceof GroupTabsWidget) {
				return current.storeState().layout;
			}
			return { widgets: [current] };
		}

		const children: GroupTabsWidget.LayoutChildState[] = [];
		const sizes: number[] = [];
		for (let index = 0; index < area.children.length; index++) {
			const child = this.toGroupChild(area.children[index]);
			if (child) {
				children.push(child);
				sizes.push(area.sizes[index] ?? 1);
			}
		}
		if (children.length === 0) {
			return undefined;
		}
		const total = sizes.reduce((sum, size) => sum + size, 0);
		return {
			orientation: area.orientation,
			children,
			relativeSizes: total > 0 ? sizes.map(size => size / total) : undefined
		};
	}

	protected layoutWidgetCount(layout: GroupTabsWidget.LayoutNodeState): number {
		let count = 0;
		for (const child of layout.children) {
			count += 'widgets' in child ? child.widgets.length : this.layoutWidgetCount(child);
		}
		return count;
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
