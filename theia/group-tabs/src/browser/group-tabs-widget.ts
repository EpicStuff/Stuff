import { Disposable } from '@theia/core';
import { Message, Navigatable, SplitWidget, Widget } from '@theia/core/lib/browser';
import { TabBarDelegator } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

/**
 * One top level tab holding a primary (source) pane and a secondary (companion) pane side by side.
 * It is created through the WidgetManager so that ShellLayoutRestorer can store it and recreate its panes.
 */
export class GroupTabsWidget extends SplitWidget implements TabBarDelegator {
	static readonly FACTORY_ID = 'group-tabs';

	protected closing = false;
	protected lastRelativeSizes = [0.5, 0.5];
	protected focusedPane?: Widget;
	protected titleSource?: Widget;
	// Panes left out of the stored layout, e.g. previews of a server that does not survive a reload.
	protected readonly transientPanes = new WeakSet<Widget>();

	constructor(options: GroupTabsWidget.Options) {
		super({ orientation: 'horizontal' });

		this.id = `${GroupTabsWidget.FACTORY_ID}:${options.id}`;
		this.addClass('theia-group-tabs-widget');
		this.title.closable = true;
		this.toDispose.push(Disposable.create(() => this.titleSource?.title.changed.disconnect(this.syncTitle, this)));

		const onHandleMoved = (): void => {
			this.lastRelativeSizes = this.relativeSizes();
		};
		this.splitPanel.handleMoved.connect(onHandleMoved);
		this.toDispose.push(Disposable.create(() => this.splitPanel.handleMoved.disconnect(onHandleMoved)));

		// Returning to the outer tab focuses the pane that had focus last.
		this.addEventListener(this.node, 'focusin', event => {
			this.focusedPane = this.panes.find(pane => pane.node.contains(event.target as Node)) ?? this.focusedPane;
		});
	}

	get primary(): Widget | undefined {
		return this.panes[0];
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

	restoreRelativeSizes(): void {
		this.setRelativeSizes(this.lastRelativeSizes);
	}

	override storeState(): SplitWidget.State {
		const widgets = this.panes.filter(pane => !this.transientPanes.has(pane));
		return {
			orientation: this.orientation,
			widgets,
			relativeSizes: widgets.length === this.panes.length ? this.relativeSizes() : undefined
		};
	}

	override restoreState(oldState: SplitWidget.State): void {
		super.restoreState(oldState);
		if (oldState.relativeSizes?.length === this.panes.length) {
			this.lastRelativeSizes = oldState.relativeSizes;
		}
	}

	override getTrackableWidgets(): Widget[] {
		// Lumino emits `disposed` before removing a widget from its parent, so unwrapping from a disposed signal
		// would otherwise hand the dead pane back to the shell's focus tracker after it has already untracked it.
		return super.getTrackableWidgets().filter(pane => !pane.isDisposed);
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
		// Dock layouts hide widgets they remove and background tabs are hidden, and a split panel keeps that state.
		pane.show();
		super.onPaneAdded(pane);
	}

	// Runs after insertion: Lumino sends child-added before the split layout lists the new pane.
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

	activateWidget(id: string): Widget | undefined {
		const pane = this.panes.find(candidate => candidate.id === id);
		if (pane) {
			// The shell activates this widget before the pane; both requests are queued, so remember the target
			// for onActivateRequest instead of letting it focus a different pane afterwards.
			this.focusedPane = pane;
			pane.activate();
		}
		return pane;
	}

	revealWidget(id: string): Widget | undefined {
		// Both panes are visible whenever the outer tab is.
		return this.panes.find(candidate => candidate.id === id);
	}

	protected override onActivateRequest(msg: Message): void {
		// SplitWidget only focuses its own panel node, which leaves every pane without focus.
		const pane = this.focusedPane && this.panes.includes(this.focusedPane) && !this.focusedPane.isDisposed ? this.focusedPane : this.primary;
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
		// Companion first: the layout would dispose the primary first, and if the companion held focus, losing it
		// then makes the disposed primary editor current again (editor status bar reads its null cursor).
		for (const pane of [...this.panes].reverse()) {
			pane.dispose();
		}
		super.dispose();
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
}
