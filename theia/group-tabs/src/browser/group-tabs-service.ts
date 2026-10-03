import { Disposable, DisposableCollection, generateUuid } from '@theia/core';
import { ApplicationShell, Widget, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { WebviewMessageChannels, WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { GroupTabsWidget } from './group-tabs-widget';

interface GroupTabsRecord {
	primary: Widget;
	secondary: Widget;
	toDispose: DisposableCollection;
	unwrapping?: Promise<void>;
}

export interface GroupTabsPairOptions {
	/**
	 * Whether the secondary is stored with the layout and recreated on reload. Defaults to true.
	 * Without it, a restored group falls back to the primary as a normal tab.
	 */
	restoreSecondary?: boolean;
}

@injectable()
export class GroupTabsService {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(WidgetManager)
	protected readonly widgetManager!: WidgetManager;

	protected readonly pairByChild = new WeakMap<Widget, GroupTabsWidget>();
	protected readonly records = new Map<GroupTabsWidget, GroupTabsRecord>();

	getPair(widget: Widget | undefined): GroupTabsWidget | undefined {
		if (!widget) {
			return undefined;
		}
		if (widget instanceof GroupTabsWidget) {
			return this.records.has(widget) ? widget : undefined;
		}
		return this.pairByChild.get(widget);
	}

	getPrimary(widget: Widget | undefined): Widget | undefined {
		const pair = this.getPair(widget);
		return pair ? this.records.get(pair)!.primary : widget;
	}

	async pair(primary: Widget, secondary: Widget, options: GroupTabsPairOptions = {}): Promise<GroupTabsWidget> {
		if (primary === secondary) {
			throw new Error('Cannot group a widget with itself');
		}
		if (primary.isDisposed || secondary.isDisposed) {
			throw new Error('Cannot group a disposed widget');
		}

		const existingPrimaryPair = this.getPair(primary);
		if (existingPrimaryPair) {
			const existing = this.records.get(existingPrimaryPair)!;
			if (existing.secondary === secondary) {
				await this.shell.activateWidget(primary.id);
				return existingPrimaryPair;
			}
			// A group has one companion, so a new one replaces it. VS Code Markdown does this on every
			// Preview to Side: it cannot match the grouped preview's view column, so it creates a new
			// preview and disposes the old one, in either order relative to this call.
			const previous = existing.secondary;
			await this.unwrap(existingPrimaryPair);
			if (!previous.isDisposed) {
				previous.dispose();
			}
			if (primary.isDisposed || secondary.isDisposed) {
				throw new Error('Cannot group a disposed widget');
			}
		}

		const existingSecondaryPair = this.getPair(secondary);
		if (existingSecondaryPair) {
			await this.unwrap(existingSecondaryPair);
		}

		const primaryArea = this.shell.getAreaFor(primary);
		if (primaryArea !== 'main') {
			throw new Error('Group Tabs currently requires the primary widget to be in the main area');
		}

		const pair = await this.widgetManager.getOrCreateWidget<GroupTabsWidget>(GroupTabsWidget.FACTORY_ID, { id: generateUuid() });
		await this.shell.addWidget(pair, {
			area: 'main',
			ref: primary,
			mode: 'tab-after'
		});

		primary.parent = null;
		secondary.parent = null;
		pair.addPane(primary);
		pair.addPane(secondary);
		pair.setRelativeSizes([0.5, 0.5]);
		this.redeliverWebviewContent(primary);
		this.redeliverWebviewContent(secondary);
		if (options.restoreSecondary === false) {
			pair.markTransient(secondary);
		}

		this.registerPair(pair);
		await this.shell.activateWidget(primary.id);
		return pair;
	}

	async closeSecondary(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		const secondary = pair && this.records.get(pair)!.secondary;
		if (secondary && !secondary.isDisposed) {
			secondary.dispose();
		}
	}

	/**
	 * Registers groups that ShellLayoutRestorer recreated. A group whose companion was not stored or could not be
	 * restored gives its remaining pane back to the dock as a normal tab.
	 */
	async adoptRestored(): Promise<void> {
		for (const pair of this.shell.getWidgets('main')) {
			if (!(pair instanceof GroupTabsWidget) || this.records.has(pair)) {
				continue;
			}
			const panes = pair.panes.filter(pane => !pane.isDisposed);
			if (panes.length === 2) {
				this.registerPair(pair);
				continue;
			}
			// The shell's current widget is not settled yet while the layout initializes; the tab bar's is.
			const current = this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title;
			for (const pane of panes) {
				pane.parent = null;
				await this.shell.addWidget(pane, { area: 'main', ref: pair, mode: 'tab-after' });
			}
			pair.dispose();
			if (current && panes[0]) {
				await this.shell.revealWidget(panes[0].id);
			}
		}
	}

	protected registerPair(pair: GroupTabsWidget): void {
		const toDispose = new DisposableCollection();
		const [primary, secondary] = pair.panes;
		const record: GroupTabsRecord = {
			primary,
			secondary,
			toDispose
		};
		this.records.set(pair, record);
		this.pairByChild.set(primary, pair);
		this.pairByChild.set(secondary, pair);

		const onPrimaryDisposed = (): void => {
			if (!pair.isClosing && !pair.isDisposed) {
				pair.dispose();
			}
		};
		const onSecondaryDisposed = (): void => {
			if (!pair.isClosing && !pair.isDisposed && !record.unwrapping) {
				void this.unwrap(pair);
			}
		};
		const onPairDisposed = (): void => this.clearPair(pair);

		primary.disposed.connect(onPrimaryDisposed);
		secondary.disposed.connect(onSecondaryDisposed);
		pair.disposed.connect(onPairDisposed);

		toDispose.pushAll([
			Disposable.create(() => primary.disposed.disconnect(onPrimaryDisposed)),
			Disposable.create(() => secondary.disposed.disconnect(onSecondaryDisposed)),
			Disposable.create(() => pair.disposed.disconnect(onPairDisposed)),
			// Theia may move a grouped child back into the dock, e.g. webviews-main reattaches a webview whenever
			// an extension reveals it in an explicit view column, because grouped children have no column of their own.
			this.shell.onDidAddWidget(widget => {
				if (widget === record.primary || widget === record.secondary) {
					setTimeout(() => this.readopt(pair, widget), 0);
				}
			})
		]);
	}

	protected readopt(pair: GroupTabsWidget, widget: Widget): void {
		const record = this.records.get(pair);
		if (!record || record.unwrapping || pair.isDisposed || widget.isDisposed || pair.panes.includes(widget)) {
			return;
		}

		const activate = this.shell.activeWidget === widget;
		pair.insertPane(widget === record.primary ? 0 : pair.panes.length, widget);
		pair.restoreRelativeSizes();
		this.redeliverWebviewContent(widget);
		void (activate ? this.shell.activateWidget(widget.id) : this.shell.revealWidget(widget.id));
	}

	/**
	 * A moved webview replaces its iframe. If the old iframe was still loading, its late webview-ready message
	 * resolves the new iframe's ready state early (WebviewWidget only checks the webview id), the content is posted
	 * before the new iframe listens, and the preview stays blank and never stores the state its serializer needs.
	 * Resending the content on every webview-ready shortly after the move reaches the new iframe once it is ready.
	 */
	protected redeliverWebviewContent(widget: Widget): void {
		if (!(widget instanceof WebviewWidget)) {
			return;
		}
		const listener = (event: MessageEvent): void => {
			if (event.data?.target === widget.identifier.id && event.data.channel === WebviewMessageChannels.webviewReady && !widget.isDisposed) {
				widget.reload();
			}
		};
		window.addEventListener('message', listener);
		setTimeout(() => window.removeEventListener('message', listener), 5000);
	}

	protected unwrap(pair: GroupTabsWidget): Promise<void> {
		const record = this.records.get(pair);
		if (!record || pair.isDisposed) {
			return Promise.resolve();
		}
		// Concurrent callers (a disposed companion and a replacing pair()) wait for the same unwrap.
		record.unwrapping ??= (async () => {
			const primary = record.primary;
			if (primary.isDisposed) {
				pair.dispose();
				return;
			}

			// Detach without disposing; the dock layout then adopts it next to the outer tab.
			primary.parent = null;
			await this.shell.addWidget(primary, {
				area: 'main',
				ref: pair,
				mode: 'tab-after'
			});

			this.clearPair(pair);
			pair.dispose();
			await this.shell.activateWidget(primary.id);
		})();
		return record.unwrapping;
	}

	protected clearPair(pair: GroupTabsWidget): void {
		const record = this.records.get(pair);
		if (!record) {
			return;
		}

		record.toDispose.dispose();
		this.records.delete(pair);
		this.pairByChild.delete(record.primary);
		this.pairByChild.delete(record.secondary);
	}
}
