import { Disposable, generateUuid } from '@theia/core';
import { Message, Navigatable, SplitWidget, Widget } from '@theia/core/lib/browser';
import { TabBarDelegator } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

export class GroupTabsWidget extends SplitWidget implements TabBarDelegator {
	protected closing = false;
	protected lastRelativeSizes = [0.5, 0.5];
	protected focusedPane?: Widget;

	constructor(
		readonly primary: Widget,
		readonly secondary: Widget
	) {
		super({
			orientation: 'horizontal',
			navigatable: Navigatable.is(primary) ? primary : undefined
		});

		this.id = `group-tabs:${generateUuid()}`;
		this.addClass('theia-group-tabs-widget');
		this.title.closable = true;
		this.syncTitle();

		primary.title.changed.connect(this.syncTitle, this);
		this.toDispose.push(Disposable.create(() => primary.title.changed.disconnect(this.syncTitle, this)));

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

	getTabBarDelegate(): Widget {
		return this.primary;
	}

	get isClosing(): boolean {
		return this.closing;
	}

	restoreRelativeSizes(): void {
		this.setRelativeSizes(this.lastRelativeSizes);
	}

	override getTrackableWidgets(): Widget[] {
		// Lumino emits `disposed` before removing a widget from its parent, so unwrapping from a disposed signal
		// would otherwise hand the dead pane back to the shell's focus tracker after it has already untracked it.
		return super.getTrackableWidgets().filter(pane => !pane.isDisposed);
	}

	protected override onPaneAdded(pane: Widget): void {
		// Dock layouts hide widgets they remove and background tabs are hidden, and a split panel keeps that state.
		pane.show();
		super.onPaneAdded(pane);
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
		pane.activate();
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
		this.title.label = this.primary.title.label;
		this.title.caption = this.primary.title.caption;
		this.title.iconClass = this.primary.title.iconClass;
	}
}
