import { Disposable, DisposableCollection } from '@theia/core';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { GroupTabsWidget } from './group-tabs-widget';

interface GroupTabsRecord {
	primary: Widget;
	secondary: Widget;
	toDispose: DisposableCollection;
	unpairing: boolean;
}

@injectable()
export class GroupTabsService {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

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
		return pair?.primary ?? widget;
	}

	async pair(primary: Widget, secondary: Widget): Promise<GroupTabsWidget> {
		if (primary === secondary) {
			throw new Error('Cannot group a widget with itself');
		}
		if (primary.isDisposed || secondary.isDisposed) {
			throw new Error('Cannot group a disposed widget');
		}

		const existingPrimaryPair = this.getPair(primary);
		if (existingPrimaryPair) {
			if (existingPrimaryPair.secondary === secondary) {
				await this.shell.activateWidget(primary.id);
				return existingPrimaryPair;
			}
			throw new Error('The primary widget is already grouped with another widget');
		}

		const existingSecondaryPair = this.getPair(secondary);
		if (existingSecondaryPair) {
			await this.unwrap(existingSecondaryPair);
		}

		const primaryArea = this.shell.getAreaFor(primary);
		if (primaryArea !== 'main') {
			throw new Error('Group Tabs currently requires the primary widget to be in the main area');
		}

		const pair = new GroupTabsWidget(primary, secondary);
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

		this.registerPair(pair);
		await this.shell.activateWidget(primary.id);
		return pair;
	}

	async closeSecondary(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		if (!pair || pair.secondary.isDisposed) {
			return;
		}
		pair.secondary.dispose();
	}

	protected registerPair(pair: GroupTabsWidget): void {
		const toDispose = new DisposableCollection();
		const record: GroupTabsRecord = {
			primary: pair.primary,
			secondary: pair.secondary,
			toDispose,
			unpairing: false
		};
		this.records.set(pair, record);
		this.pairByChild.set(pair.primary, pair);
		this.pairByChild.set(pair.secondary, pair);

		const onPrimaryDisposed = (): void => {
			if (!pair.isClosing && !pair.isDisposed) {
				pair.dispose();
			}
		};
		const onSecondaryDisposed = (): void => {
			if (!pair.isClosing && !pair.isDisposed && !record.unpairing) {
				void this.unwrap(pair);
			}
		};
		const onPairDisposed = (): void => this.clearPair(pair);

		pair.primary.disposed.connect(onPrimaryDisposed);
		pair.secondary.disposed.connect(onSecondaryDisposed);
		pair.disposed.connect(onPairDisposed);

		toDispose.pushAll([
			Disposable.create(() => pair.primary.disposed.disconnect(onPrimaryDisposed)),
			Disposable.create(() => pair.secondary.disposed.disconnect(onSecondaryDisposed)),
			Disposable.create(() => pair.disposed.disconnect(onPairDisposed))
		]);
	}

	protected async unwrap(pair: GroupTabsWidget): Promise<void> {
		const record = this.records.get(pair);
		if (!record || record.unpairing || pair.isDisposed) {
			return;
		}
		record.unpairing = true;

		const primary = record.primary;
		if (primary.isDisposed) {
			pair.dispose();
			return;
		}

		primary.parent = null;
		await this.shell.addWidget(primary, {
			area: 'main',
			ref: pair,
			mode: 'tab-after'
		});

		this.clearPair(pair);
		pair.dispose();
		await this.shell.activateWidget(primary.id);
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
