import { Disposable, Emitter, URI } from '@theia/core';
import {
	ApplicationShell,
	BaseWidget,
	BoxLayout,
	BoxPanel,
	DockLayout,
	DockPanel,
	Message,
	Navigatable,
	Saveable,
	SaveableSource,
	StatefulWidget,
	Widget
} from '@theia/core/lib/browser';
import { CompositeSaveable } from '@theia/core/lib/browser/saveable';
import { toArray } from '@theia/core/shared/@lumino/algorithm';
import { TabBarDelegator } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

export class GroupTabsWidget extends BaseWidget implements ApplicationShell.TrackableWidgetProvider, SaveableSource, Navigatable, StatefulWidget, TabBarDelegator {
	static readonly FACTORY_ID = 'group-tabs';

	protected readonly dockPanel: DockPanel;
	protected readonly compositeSaveable = new GroupTabsSaveable(() => this.exclusiveSaveables());
	protected readonly onDidChangeTrackableWidgetsEmitter = new Emitter<Widget[]>();
	readonly onDidChangeTrackableWidgets = this.onDidChangeTrackableWidgetsEmitter.event;

	protected closing = false;
	protected focusedPane?: Widget;
	protected titleSource?: Widget;
	protected navigatable?: Navigatable;
	protected readonly transientPanes = new WeakSet<Widget>();
	protected readonly rememberedRules = new Set<string>();
	protected ungroupLayout?: DockPanel.ILayoutConfig;

	constructor(options: GroupTabsWidget.Options, protected readonly shell: ApplicationShell) {
		super();

		this.id = `${GroupTabsWidget.FACTORY_ID}:${options.id}`;
		this.addClass('theia-group-tabs-widget');
		this.title.closable = true;

		// Tab drags from outside fall through to the outer main panel instead of landing in the hidden inner tab bars.
		this.dockPanel = new DockPanel({ mode: 'multiple-document', spacing: 0, tabsConstrained: true });
		this.dockPanel.addClass('theia-group-tabs-dock-panel');

		const layout = new BoxLayout({ direction: 'top-to-bottom', spacing: 0 });
		this.layout = layout;
		BoxPanel.setStretch(this.dockPanel, 1);
		layout.addWidget(this.dockPanel);

		this.toDispose.push(this.compositeSaveable);
		this.toDispose.push(this.onDidChangeTrackableWidgetsEmitter);
		this.toDispose.push(Disposable.create(() => this.titleSource?.title.changed.disconnect(this.syncTitle, this)));
		this.toDispose.push(shell.onDidAddWidget(() => this.compositeSaveable.refresh()));
		this.toDispose.push(shell.onDidRemoveWidget(() => this.compositeSaveable.refresh()));

		const activatePaneFromEvent = (event: Event): void => {
			const pane = this.getTrackableWidgets().find(candidate => candidate.node.contains(event.target as Node));
			if (!pane) {
				return;
			}
			this.focusedPane = pane;
			pane.activate();
		};
		this.addEventListener(this.node, 'focusin', activatePaneFromEvent);
		this.addEventListener(this.node, 'pointerdown', activatePaneFromEvent, true);
	}

	get primary(): Widget | undefined {
		return this.getTrackableWidgets()[0];
	}

	get saveable(): Saveable {
		return this.compositeSaveable;
	}

	getTabBarDelegate(): Widget {
		return this.primary ?? this;
	}

	get isClosing(): boolean {
		return this.closing;
	}

	getResourceUri(): URI | undefined {
		return this.navigatable?.getResourceUri();
	}

	createMoveToUri(resourceUri: URI): URI | undefined {
		return this.navigatable?.createMoveToUri(resourceUri);
	}

	markTransient(pane: Widget): void {
		this.transientPanes.add(pane);
	}

	addRememberedRule(rule: string): void {
		this.rememberedRules.add(rule);
	}

	getRememberedRules(): readonly string[] {
		return [...this.rememberedRules];
	}

	setUngroupLayout(layout: DockPanel.ILayoutConfig): void {
		this.ungroupLayout = this.cloneLayout(layout);
	}

	getUngroupLayout(): DockPanel.ILayoutConfig | undefined {
		return this.ungroupLayout && this.cloneLayout(this.ungroupLayout);
	}

	setGroupLayout(layout: DockPanel.ILayoutConfig): void {
		this.dockPanel.restoreLayout(this.cloneLayout(layout));
		this.afterLayoutChanged();
	}

	getGroupLayout(): DockPanel.ILayoutConfig {
		return this.cloneLayout(this.dockPanel.saveLayout());
	}

	containsPane(pane: Widget): boolean {
		return this.getTrackableWidgets().includes(pane);
	}

	addRootPane(pane: Widget): void {
		this.dockPanel.addWidget(pane);
		this.afterLayoutChanged();
	}

	addRelativePane(pane: Widget, ref: Widget, relation: string): void {
		if (!this.containsPane(ref)) {
			const primary = this.primary;
			if (primary) {
				this.dockPanel.addWidget(pane, { ref: primary, mode: 'split-right' });
			} else {
				this.dockPanel.addWidget(pane);
			}
			this.afterLayoutChanged();
			return;
		}

		this.dockPanel.addWidget(pane, {
			ref,
			mode: this.toDockMode(relation)
		});
		this.afterLayoutChanged();
	}

	detachPane(pane: Widget): void {
		if (!this.containsPane(pane)) {
			return;
		}
		pane.parent = null;
		this.afterLayoutChanged();
	}

	releasePanes(): Widget[] {
		const panes = this.getTrackableWidgets();
		for (const pane of panes) {
			pane.parent = null;
		}
		this.afterLayoutChanged();
		return panes;
	}

	storeState(): GroupTabsWidget.State {
		return {
			layout: this.filteredLayout(this.dockPanel.saveLayout()),
			ungroupLayout: this.ungroupLayout && this.filteredLayout(this.ungroupLayout),
			rememberedRules: [...this.rememberedRules]
		};
	}

	restoreState(oldState: object): void {
		const state = oldState as GroupTabsWidget.State;
		this.ungroupLayout = state.ungroupLayout && this.cloneLayout(state.ungroupLayout);
		this.rememberedRules.clear();
		for (const rule of state.rememberedRules ?? []) {
			this.rememberedRules.add(rule);
		}
		if (state.layout) {
			this.dockPanel.restoreLayout(this.cloneLayout(state.layout));
		}
		this.afterLayoutChanged();
	}

	getTrackableWidgets(): Widget[] {
		return toArray(this.dockPanel.widgets());
	}

	activateWidget(id: string): Widget | undefined {
		const pane = this.getTrackableWidgets().find(candidate => candidate.id === id);
		if (pane) {
			this.focusedPane = pane;
			this.dockPanel.activateWidget(pane);
			pane.activate();
		}
		return pane;
	}

	revealWidget(id: string): Widget | undefined {
		const pane = this.getTrackableWidgets().find(candidate => candidate.id === id);
		if (pane) {
			this.dockPanel.selectWidget(pane);
		}
		return pane;
	}

	protected override onActivateRequest(msg: Message): void {
		const panes = this.getTrackableWidgets();
		const pane = this.focusedPane && panes.includes(this.focusedPane) && !this.focusedPane.isDisposed ? this.focusedPane : panes[0];
		if (pane) {
			this.dockPanel.activateWidget(pane);
			pane.activate();
		} else {
			super.onActivateRequest(msg);
		}
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.closing = true;
		for (const pane of this.getTrackableWidgets()) {
			pane.dispose();
		}
		super.dispose();
	}

	protected afterLayoutChanged(): void {
		this.hideInnerTabBars();
		this.syncSaveables();
		this.updatePrimary();
		this.onDidChangeTrackableWidgetsEmitter.fire(this.getTrackableWidgets());
	}

	protected hideInnerTabBars(): void {
		for (const tabBar of toArray(this.dockPanel.tabBars())) {
			tabBar.hide();
		}
	}

	protected syncSaveables(): void {
		const current = new Set<Saveable>();
		for (const pane of this.getTrackableWidgets()) {
			const saveable = Saveable.get(pane);
			if (saveable) {
				current.add(saveable);
				this.compositeSaveable.add(saveable);
			}
		}
		for (const saveable of this.compositeSaveable.allSaveables) {
			if (!current.has(saveable)) {
				this.compositeSaveable.remove(saveable);
			}
		}
		this.compositeSaveable.refresh();
	}

	protected exclusiveSaveables(): Set<Saveable> {
		const outside = this.shell.widgets.filter(widget => widget.isAttached && !this.node.contains(widget.node));
		return new Set(this.getTrackableWidgets()
			.filter(pane => Saveable.closingWidgetWouldLoseSaveable(pane, outside))
			.map(pane => Saveable.get(pane))
			.filter((saveable): saveable is Saveable => !!saveable));
	}

	protected toDockMode(relation: string): DockLayout.InsertMode {
		switch (relation) {
			case 'split-left':
			case 'open-to-left':
				return 'split-left';
			case 'split-top':
				return 'split-top';
			case 'split-bottom':
				return 'split-bottom';
			default:
				return 'split-right';
		}
	}

	protected filteredLayout(layout: DockPanel.ILayoutConfig): DockPanel.ILayoutConfig {
		return {
			main: this.filteredArea(layout.main)
		};
	}

	protected filteredArea(area: DockLayout.AreaConfig | null): DockLayout.AreaConfig | null {
		if (!area) {
			return null;
		}
		if (area.type === 'tab-area') {
			const widgets = area.widgets.filter(widget => !widget.isDisposed && !this.transientPanes.has(widget));
			if (widgets.length === 0) {
				return null;
			}
			const selected = area.widgets[area.currentIndex];
			const currentIndex = Math.max(0, widgets.indexOf(selected));
			return {
				type: 'tab-area',
				widgets,
				currentIndex
			};
		}

		const children: DockLayout.AreaConfig[] = [];
		const sizes: number[] = [];
		for (let index = 0; index < area.children.length; index++) {
			const child = this.filteredArea(area.children[index]);
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

	protected cloneLayout(layout: DockPanel.ILayoutConfig): DockPanel.ILayoutConfig {
		return {
			main: this.cloneArea(layout.main)
		};
	}

	protected cloneArea(area: DockLayout.AreaConfig | null): DockLayout.AreaConfig | null {
		if (!area) {
			return null;
		}
		if (area.type === 'tab-area') {
			return {
				type: 'tab-area',
				widgets: [...area.widgets],
				currentIndex: area.currentIndex
			};
		}
		return {
			type: 'split-area',
			orientation: area.orientation,
			children: area.children.map(child => this.cloneArea(child) as DockLayout.AreaConfig),
			sizes: [...area.sizes]
		};
	}

	protected updatePrimary(): void {
		const primary = this.primary;
		if (!primary || primary === this.titleSource) {
			return;
		}
		this.titleSource?.title.changed.disconnect(this.syncTitle, this);
		this.titleSource = primary;
		primary.title.changed.connect(this.syncTitle, this);
		this.navigatable = Navigatable.is(primary) ? primary : undefined;
		this.syncTitle();
	}

	protected syncTitle(): void {
		if (this.titleSource) {
			this.title.label = this.titleSource.title.label;
			this.title.caption = this.titleSource.title.caption;
			this.title.iconClass = this.titleSource.title.iconClass;
		}
	}
}

// Only covers documents no widget outside the group still holds, matching how Theia closes a single tab.
class GroupTabsSaveable extends CompositeSaveable {
	constructor(protected readonly exclusive: () => Set<Saveable>) {
		super();
	}

	override get dirty(): boolean {
		return this.saveables.some(saveable => saveable.dirty);
	}

	override get saveables(): readonly Saveable[] {
		const exclusive = this.exclusive();
		return this.allSaveables.filter(saveable => exclusive.has(saveable));
	}

	get allSaveables(): readonly Saveable[] {
		return super.saveables;
	}

	refresh(): void {
		const dirty = this.dirty;
		if (dirty !== this.isDirty) {
			this.isDirty = dirty;
			this.onDirtyChangedEmitter.fire();
		}
	}
}

export namespace GroupTabsWidget {
	export interface Options {
		id: string;
	}

	export interface State {
		layout?: DockPanel.ILayoutConfig;
		ungroupLayout?: DockPanel.ILayoutConfig;
		rememberedRules?: string[];
	}
}
