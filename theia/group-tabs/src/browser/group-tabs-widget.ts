import { Disposable, generateUuid } from '@theia/core';
import { Navigatable, SplitWidget, TabBarDelegator, Widget } from '@theia/core/lib/browser';

export class GroupTabsWidget extends SplitWidget implements TabBarDelegator {
	protected closing = false;

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
	}

	getTabBarDelegate(): Widget {
		return this.primary;
	}

	get isClosing(): boolean {
		return this.closing;
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.closing = true;
		const panes = [...this.panes];
		super.dispose();

		for (const pane of panes) {
			if (!pane.isDisposed) {
				pane.dispose();
			}
		}
	}

	protected syncTitle(): void {
		this.title.label = this.primary.title.label;
		this.title.caption = this.primary.title.caption;
		this.title.iconClass = this.primary.title.iconClass;
	}
}
