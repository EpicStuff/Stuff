import { Disposable } from '@theia/core';
import { Message, Navigatable, SplitWidget, Widget } from '@theia/core/lib/browser';
import { TabBarDelegator } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

type Orientation = 'horizontal' | 'vertical';

class GroupTabsInnerSplitWidget extends SplitWidget {
	constructor(orientation: Orientation) {
		super({ orientation });
	}
}

export class GroupTabsWidget extends SplitWidget implements TabBarDelegator {
	static readonly FACTORY_ID = 'group-tabs';

	protected closing = false;
	protected focusedPane?: Widget;
	protected titleSource?: Widget;
	protected readonly transientPanes = new WeakSet<Widget>();

	constructor(options: GroupTabsWidget.Options) {
		super({ orientation: 'horizontal' });

		this.id = `${GroupTabsWidget.FACTORY_ID}:${options.id}`;
		this.addClass('theia-group-tabs-widget');
		this.title.closable = true;
		this.toDispose.push(Disposable.create(() => this.titleSource?.title.changed.disconnect(this.syncTitle, this)));

		this.addEventListener(this.node, 'focusin', event => {
			this.focusedPane = this.getTrackableWidgets().find(pane => pane.node.contains(event.target as Node)) ?? this.focusedPane;
		});
	}

	get primary(): Widget | undefined {
		return this.getTrackableWidgets()[0];
	}

	getTabBarDelegate(): Widget {
		return this.primary ?? this;
	}

	get isClosing(): boolean {
		return this.closing;
	}

	markTransient(pane: Widget): void {
		this.transientPanes.add(pane);
	}

	containsPane(pane: Widget): boolean {
		return this.getTrackableWidgets().includes(pane);
	}

	addRootPane(pane: Widget): void {
		this.addPane(pane);
		this.afterLayoutChanged();
	}

	addRelativePane(pane: Widget, ref: Widget, relation: string): void {
		if (!this.containsPane(ref)) {
			this.addPane(pane);
			this.afterLayoutChanged();
			return;
		}

		const direction = this.toSplitDirection(relation);
		const orientation: Orientation = direction === 'top' || direction === 'bottom' ? 'vertical' : 'horizontal';
		const before = direction === 'left' || direction === 'top';
		const owner = this.ownerOf(ref);
		if (!owner) {
			this.addPane(pane);
			this.afterLayoutChanged();
			return;
		}

		const index = owner.panes.indexOf(ref);
		if (owner === this && owner.panes.length === 1) {
			owner.orientation = orientation;
			owner.insertPane(before ? index : index + 1, pane);
			owner.setRelativeSizes([0.5, 0.5]);
			this.afterLayoutChanged();
			return;
		}

		if (owner.orientation === orientation) {
			const oldSizes = owner.relativeSizes();
			const refSize = oldSizes[index] ?? 1 / Math.max(owner.panes.length, 1);
			const newSizes = [...oldSizes];
			newSizes[index] = refSize / 2;
			newSizes.splice(before ? index : index + 1, 0, refSize / 2);
			owner.insertPane(before ? index : index + 1, pane);
			if (newSizes.length === owner.panes.length) {
				owner.setRelativeSizes(newSizes);
			}
			this.afterLayoutChanged();
			return;
		}

		const parentSizes = owner.relativeSizes();
		const nested = new GroupTabsInnerSplitWidget(orientation);
		ref.parent = null;
		owner.insertPane(index, nested);
		if (before) {
			nested.addPane(pane);
			nested.addPane(ref);
		} else {
			nested.addPane(ref);
			nested.addPane(pane);
		}
		nested.setRelativeSizes([0.5, 0.5]);
		if (parentSizes.length === owner.panes.length) {
			owner.setRelativeSizes(parentSizes);
		}
		this.afterLayoutChanged();
	}

	detachPane(pane: Widget): void {
		const owner = this.ownerOf(pane);
		if (!owner) {
			return;
		}
		pane.parent = null;
		this.collapse(owner);
		this.flattenRoot();
		this.afterLayoutChanged();
	}

	override storeState(): GroupTabsWidget.State {
		return {
			widgets: [],
			layout: this.serializeNode(this)
		};
	}

	override restoreState(oldState: SplitWidget.State): void {
		const state = oldState as GroupTabsWidget.State;
		if (!state.layout) {
			super.restoreState(oldState);
			this.afterLayoutChanged();
			return;
		}

		this.restoreNode(this, state.layout);
		this.afterLayoutChanged();
	}

	override getTrackableWidgets(): Widget[] {
		return this.collectLeaves(this);
	}

	override addPane(pane: Widget): void {
		super.addPane(pane);
		this.updatePrimary();
	}

	override insertPane(index: number, pane: Widget): void {
		super.insertPane(index, pane);
		this.updatePrimary();
	}

	protected override onPaneAdded(pane: Widget): void {
		pane.show();
		super.onPaneAdded(pane);
		this.updatePrimary();
	}

	activateWidget(id: string): Widget | undefined {
		const pane = this.getTrackableWidgets().find(candidate => candidate.id === id);
		if (pane) {
			this.focusedPane = pane;
			pane.activate();
		}
		return pane;
	}

	revealWidget(id: string): Widget | undefined {
		return this.getTrackableWidgets().find(candidate => candidate.id === id);
	}

	protected override onActivateRequest(msg: Message): void {
		const panes = this.getTrackableWidgets();
		const pane = this.focusedPane && panes.includes(this.focusedPane) && !this.focusedPane.isDisposed ? this.focusedPane : panes[0];
		if (pane) {
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
		for (const pane of [...this.getTrackableWidgets()].reverse()) {
			pane.dispose();
		}
		super.dispose();
	}

	protected afterLayoutChanged(): void {
		this.updatePrimary();
		this.fireDidChangeTrackableWidgets();
	}

	protected collectLeaves(owner: SplitWidget): Widget[] {
		const result: Widget[] = [];
		for (const pane of owner.panes) {
			if (pane instanceof GroupTabsInnerSplitWidget) {
				result.push(...this.collectLeaves(pane));
			} else {
				result.push(pane);
			}
		}
		return result;
	}

	protected ownerOf(pane: Widget): SplitWidget | undefined {
		const owner = pane.parent?.parent;
		if (owner === this) {
			return this;
		}
		return owner instanceof GroupTabsInnerSplitWidget ? owner : undefined;
	}

	protected collapse(owner: SplitWidget): void {
		let current = owner;
		while (current !== this) {
			const parent = this.ownerOf(current);
			if (!parent) {
				return;
			}

			if (current.panes.length === 0) {
				current.parent = null;
				current.dispose();
				current = parent;
				continue;
			}

			if (current.panes.length === 1) {
				const only = current.panes[0];
				const index = parent.panes.indexOf(current);
				const parentSizes = parent.relativeSizes();
				only.parent = null;
				current.parent = null;
				parent.insertPane(index, only);
				current.dispose();
				if (parentSizes.length === parent.panes.length) {
					parent.setRelativeSizes(parentSizes);
				}
				current = parent;
				continue;
			}
			return;
		}
	}

	protected flattenRoot(): void {
		if (this.panes.length !== 1 || !(this.panes[0] instanceof GroupTabsInnerSplitWidget)) {
			return;
		}

		const nested = this.panes[0];
		const children = [...nested.panes];
		const sizes = nested.relativeSizes();
		const orientation = nested.orientation as Orientation;
		for (const child of children) {
			child.parent = null;
		}
		nested.parent = null;
		nested.dispose();
		this.orientation = orientation;
		for (const child of children) {
			super.addPane(child);
		}
		if (sizes.length === this.panes.length) {
			this.setRelativeSizes(sizes);
		}
	}

	protected serializeNode(owner: SplitWidget): GroupTabsWidget.LayoutNodeState | undefined {
		const children: GroupTabsWidget.LayoutChildState[] = [];
		for (const pane of owner.panes) {
			if (pane instanceof GroupTabsInnerSplitWidget) {
				const nested = this.serializeNode(pane);
				if (nested) {
					children.push(nested);
				}
			} else if (!this.transientPanes.has(pane)) {
				children.push({ widgets: [pane] });
			}
		}
		if (children.length === 0) {
			return undefined;
		}
		return {
			orientation: owner.orientation as Orientation,
			children,
			relativeSizes: children.length === owner.panes.length ? owner.relativeSizes() : undefined
		};
	}

	protected restoreNode(owner: SplitWidget, state: GroupTabsWidget.LayoutNodeState): void {
		owner.orientation = state.orientation ?? 'horizontal';
		for (const child of state.children) {
			if ('widgets' in child) {
				const pane = child.widgets[0];
				if (pane && !pane.isDisposed) {
					owner.addPane(pane);
				}
			} else {
				const nested = new GroupTabsInnerSplitWidget(child.orientation ?? 'horizontal');
				owner.addPane(nested);
				this.restoreNode(nested, child);
				if (nested.panes.length === 0) {
					nested.parent = null;
					nested.dispose();
				}
			}
		}
		if (state.relativeSizes?.length === owner.panes.length) {
			owner.setRelativeSizes(state.relativeSizes);
		}
	}

	protected toSplitDirection(relation: string): 'left' | 'right' | 'top' | 'bottom' {
		switch (relation) {
			case 'split-left':
			case 'open-to-left':
				return 'left';
			case 'split-top':
				return 'top';
			case 'split-bottom':
				return 'bottom';
			default:
				return 'right';
		}
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

export namespace GroupTabsWidget {
	export interface Options {
		id: string;
	}

	export interface LayoutLeafState {
		widgets: readonly Widget[];
	}

	export interface LayoutNodeState {
		orientation?: Orientation;
		children: LayoutChildState[];
		relativeSizes?: number[];
	}

	export type LayoutChildState = LayoutLeafState | LayoutNodeState;

	export interface State extends SplitWidget.State {
		layout?: LayoutNodeState;
	}
}
