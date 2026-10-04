import { Disposable, DisposableCollection, generateUuid } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ApplicationShell, Widget, WidgetManager } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { WebviewMessageChannels, WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { GROUP_TABS_REMEMBER_GROUPS } from './group-tabs-preferences';
import { GroupTabsWidget } from './group-tabs-widget';

const LEARNED_RULES_STORAGE_KEY = 'group-tabs.learned-rules';
export const MINI_BROWSER_URL_PREVIEW_RELATION = 'mini-browser-url-preview';

export interface GroupTabsPlacement {
	ref?: Widget;
	relation: string;
	area?: ApplicationShell.Area;
}

interface LearnedGroupRule {
	parentKind: string;
	childKind: string;
	relation: string;
}

interface GroupTabsRecord {
	primary: Widget;
	members: Set<Widget>;
	placements: Map<Widget, GroupTabsPlacement>;
	memberDisposables: Map<Widget, Disposable>;
	toDispose: DisposableCollection;
}

@injectable()
export class GroupTabsService {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(WidgetManager)
	protected readonly widgetManager!: WidgetManager;

	@inject(StorageService)
	protected readonly storageService!: StorageService;

	@inject(PreferenceService)
	protected readonly preferenceService!: PreferenceService;

	protected readonly pairByChild = new WeakMap<Widget, GroupTabsWidget>();
	protected readonly records = new Map<GroupTabsWidget, GroupTabsRecord>();
	protected readonly provenance = new WeakMap<Widget, GroupTabsPlacement>();
	protected learnedRules: LearnedGroupRule[] = [];
	protected started = false;
	protected suppressShellCapture = 0;

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		const stored = await this.storageService.getData<LearnedGroupRule[]>(LEARNED_RULES_STORAGE_KEY, []);
		this.learnedRules = Array.isArray(stored)
			? stored.filter(rule => typeof rule?.parentKind === 'string' && typeof rule?.childKind === 'string' && typeof rule?.relation === 'string')
			: [];
		this.patchShellAddWidget();
	}

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
		if (!widget) {
			return undefined;
		}
		if (widget instanceof GroupTabsWidget) {
			return this.records.get(widget)?.primary ?? widget.primary;
		}
		const pair = this.getPair(widget);
		return pair ? this.records.get(pair)?.primary ?? pair.primary : widget;
	}

	resolveSource(widget: Widget | undefined): Widget | undefined {
		if (widget instanceof GroupTabsWidget) {
			return this.getPrimary(widget);
		}
		return widget;
	}

	getMembers(widget: Widget | undefined): Widget[] {
		const pair = this.getPair(widget);
		return pair ? [...(this.records.get(pair)?.members ?? pair.getTrackableWidgets())] : widget ? [widget] : [];
	}

	getGroupableWidgets(primary: Widget): Widget[] {
		const excluded = new Set(this.getMembers(primary));
		const result: Widget[] = [];
		const seen = new Set<Widget>();
		for (const area of ['main', 'right', 'left', 'bottom'] as ApplicationShell.Area[]) {
			for (const widget of this.shell.getWidgets(area)) {
				const widgets = widget instanceof GroupTabsWidget ? widget.getTrackableWidgets() : [widget];
				for (const candidate of widgets) {
					if (!candidate.isDisposed && !excluded.has(candidate) && !seen.has(candidate)) {
						seen.add(candidate);
						result.push(candidate);
					}
				}
			}
		}
		return result;
	}

	async groupManual(primaryInput: Widget, widgets: Widget[]): Promise<GroupTabsWidget | undefined> {
		const primary = this.resolveSource(primaryInput);
		if (!primary || primary.isDisposed) {
			return undefined;
		}

		const selected = [...new Set(widgets.filter(widget => widget !== primary && !widget.isDisposed))];
		if (selected.length === 0) {
			return this.getPair(primary);
		}

		const resolved = new Set<Widget>(this.getMembers(primary));
		resolved.add(primary);
		const pending = [...selected];
		let pair = this.getPair(primary);

		while (pending.length > 0) {
			let index = pending.findIndex(widget => {
				const ref = this.resolveSource(this.provenance.get(widget)?.ref);
				return !!ref && resolved.has(ref);
			});
			if (index < 0) {
				index = 0;
			}

			const child = pending.splice(index, 1)[0];
			const placement = this.provenance.get(child);
			const rememberedRef = this.resolveSource(placement?.ref);
			const source = rememberedRef && resolved.has(rememberedRef) ? rememberedRef : primary;
			const relation = placement?.relation ?? 'split-right';

			pair = await this.addRelative(source, child, {
				ref: source,
				relation,
				area: placement?.area
			}, {
				restoreSecondary: !this.isMiniBrowserUrlPreview(child)
			});

			if (placement?.ref && rememberedRef && source === rememberedRef) {
				await this.learnRule(source, child, relation);
			}
			resolved.add(child);
		}

		return pair;
	}

	async addRelative(sourceInput: Widget, widget: Widget, placement: GroupTabsPlacement, options: { restoreSecondary?: boolean } = {}): Promise<GroupTabsWidget> {
		const source = this.resolveSource(sourceInput);
		if (!source || source.isDisposed || widget.isDisposed) {
			throw new Error('Cannot group disposed widgets');
		}
		if (source === widget) {
			throw new Error('Cannot group a widget with itself');
		}

		let pair = this.getPair(source);
		const widgetPair = this.getPair(widget);
		if (pair && widgetPair === pair && pair.containsPane(widget)) {
			return pair;
		}

		if (widgetPair && widgetPair !== pair) {
			await this.detachMember(widgetPair, widget);
		}

		if (!pair) {
			pair = await this.createGroup(source);
		}

		if (this.shell.getAreaFor(widget)) {
			widget.parent = null;
		}
		pair.addRelativePane(widget, source, placement.relation);
		this.registerMember(pair, widget, placement);
		if (options.restoreSecondary === false) {
			pair.markTransient(widget);
		}
		this.redeliverWebviewContent(widget);
		await this.shell.activateWidget(source.id);
		return pair;
	}

	async pair(primary: Widget, secondary: Widget, options: { restoreSecondary?: boolean } = {}): Promise<GroupTabsWidget> {
		return this.addRelative(primary, secondary, {
			ref: primary,
			relation: 'split-right',
			area: 'main'
		}, options);
	}

	async closeSecondary(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		const record = pair && this.records.get(pair);
		if (!pair || !record) {
			return;
		}
		const secondary = [...record.members].reverse().find(member => member !== record.primary);
		if (secondary && !secondary.isDisposed) {
			secondary.dispose();
		}
	}

	noteMiniBrowserUrlPreview(widget: MiniBrowser, sourceInput: Widget | undefined): void {
		const source = this.resolveSource(sourceInput);
		if (!source || source === widget || source.isDisposed) {
			return;
		}
		this.provenance.set(widget, {
			ref: source,
			relation: MINI_BROWSER_URL_PREVIEW_RELATION,
			area: 'right'
		});
		setTimeout(() => {
			void this.maybeAutoGroup(widget);
		}, 0);
	}

	async adoptRestored(): Promise<void> {
		for (const pair of this.shell.getWidgets('main')) {
			if (!(pair instanceof GroupTabsWidget) || this.records.has(pair)) {
				continue;
			}
			const panes = pair.getTrackableWidgets().filter(pane => !pane.isDisposed);
			if (panes.length >= 2) {
				this.registerPair(pair);
				continue;
			}

			const current = this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title;
			const pane = panes[0];
			if (pane) {
				pair.detachPane(pane);
				await this.withoutShellCapture(() => this.shell.addWidget(pane, { area: 'main', ref: pair, mode: 'tab-after' }));
			}
			pair.dispose();
			if (current && pane) {
				await this.shell.revealWidget(pane.id);
			}
		}
	}

	protected patchShellAddWidget(): void {
		const original = this.shell.addWidget.bind(this.shell);
		this.shell.addWidget = async (widget: Widget, options?: Readonly<ApplicationShell.WidgetOptions>): Promise<void> => {
			if (this.suppressShellCapture > 0 || widget instanceof GroupTabsWidget) {
				await original(widget, options);
				return;
			}

			const insertion = this.shell.getInsertionOptions(options);
			const active = this.resolveSource(this.shell.activeWidget ?? this.shell.currentWidget);
			const explicitRef = this.resolveSource(options?.ref);
			const resolvedRef = this.resolveSource(insertion.addOptions.ref);
			const ref = explicitRef ?? active ?? resolvedRef;
			const relation = String(options?.mode ?? insertion.addOptions.mode ?? (insertion.area === 'main' ? 'tab-after' : `area:${insertion.area}`));
			const area = ApplicationShell.isValidArea(insertion.area) ? insertion.area : options?.area;

			await original(widget, options);

			const existingPair = this.getPair(widget);
			if (existingPair) {
				setTimeout(() => this.readopt(existingPair, widget), 0);
				return;
			}

			if (ref && ref !== widget) {
				this.provenance.set(widget, { ref, relation, area });
				setTimeout(() => {
					void this.maybeAutoGroup(widget);
				}, 0);
			}
		};
	}

	protected async maybeAutoGroup(widget: Widget): Promise<void> {
		if (!this.rememberGroupsEnabled() || widget.isDisposed) {
			return;
		}
		const placement = this.provenance.get(widget);
		const source = this.resolveSource(placement?.ref);
		if (!placement || !source || source.isDisposed || source === widget) {
			return;
		}

		const rule = this.learnedRules.find(candidate =>
			candidate.parentKind === this.widgetKind(source)
			&& candidate.childKind === this.widgetKind(widget)
			&& candidate.relation === placement.relation
		);
		if (!rule) {
			return;
		}

		try {
			await this.addRelative(source, widget, placement, {
				restoreSecondary: !this.isMiniBrowserUrlPreview(widget)
			});
		} catch (error) {
			console.error('Failed to restore remembered tab group', error);
		}
	}

	protected async learnRule(parent: Widget, child: Widget, relation: string): Promise<void> {
		if (!this.rememberGroupsEnabled()) {
			return;
		}
		const rule: LearnedGroupRule = {
			parentKind: this.widgetKind(parent),
			childKind: this.widgetKind(child),
			relation
		};
		if (this.learnedRules.some(candidate =>
			candidate.parentKind === rule.parentKind
			&& candidate.childKind === rule.childKind
			&& candidate.relation === rule.relation
		)) {
			return;
		}
		this.learnedRules.push(rule);
		await this.storageService.setData(LEARNED_RULES_STORAGE_KEY, this.learnedRules);
	}

	protected rememberGroupsEnabled(): boolean {
		return this.preferenceService.get<boolean>(GROUP_TABS_REMEMBER_GROUPS, true);
	}

	protected widgetKind(widgetInput: Widget): string {
		const widget = this.resolveSource(widgetInput) ?? widgetInput;
		if (widget instanceof WebviewWidget) {
			return `webview:${widget.viewType || 'unknown'}`;
		}
		if (widget instanceof MiniBrowser) {
			return this.isMiniBrowserUrlPreview(widget) ? 'mini-browser:url-preview' : 'mini-browser';
		}
		const description = this.widgetManager.getDescription(widget);
		if (description?.factoryId) {
			return `factory:${description.factoryId}`;
		}
		return `widget:${widget.constructor.name}`;
	}

	protected isMiniBrowserUrlPreview(widget: Widget): widget is MiniBrowser {
		if (!(widget instanceof MiniBrowser)) {
			return false;
		}
		const uri = widget.getResourceUri();
		return uri?.scheme === MiniBrowserOpenHandler.PREVIEW_URI.scheme;
	}

	protected async createGroup(primary: Widget): Promise<GroupTabsWidget> {
		const primaryArea = this.shell.getAreaFor(primary);
		if (primaryArea !== 'main') {
			throw new Error('Group Tabs requires the source widget to be in the main area');
		}

		const pair = await this.widgetManager.getOrCreateWidget<GroupTabsWidget>(GroupTabsWidget.FACTORY_ID, { id: generateUuid() });
		await this.withoutShellCapture(() => this.shell.addWidget(pair, {
			area: 'main',
			ref: primary,
			mode: 'tab-after'
		}));

		primary.parent = null;
		pair.addRootPane(primary);
		this.registerPair(pair);
		this.redeliverWebviewContent(primary);
		return pair;
	}

	protected registerPair(pair: GroupTabsWidget): void {
		const panes = pair.getTrackableWidgets();
		if (panes.length === 0) {
			return;
		}

		const record: GroupTabsRecord = {
			primary: panes[0],
			members: new Set(),
			placements: new Map(),
			memberDisposables: new Map(),
			toDispose: new DisposableCollection()
		};
		this.records.set(pair, record);

		const onPairDisposed = (): void => this.clearPair(pair);
		pair.disposed.connect(onPairDisposed);
		record.toDispose.push(Disposable.create(() => pair.disposed.disconnect(onPairDisposed)));

		for (const pane of panes) {
			this.registerMember(pair, pane);
		}
	}

	protected registerMember(pair: GroupTabsWidget, widget: Widget, placement?: GroupTabsPlacement): void {
		const record = this.records.get(pair);
		if (!record) {
			return;
		}

		if (record.members.has(widget)) {
			if (placement) {
				record.placements.set(widget, placement);
			}
			return;
		}

		record.members.add(widget);
		this.pairByChild.set(widget, pair);
		if (placement) {
			record.placements.set(widget, placement);
		}

		const onDisposed = (): void => {
			if (!pair.isClosing && !pair.isDisposed) {
				void this.detachMember(pair, widget);
			}
		};
		widget.disposed.connect(onDisposed);
		const disposable = Disposable.create(() => widget.disposed.disconnect(onDisposed));
		record.memberDisposables.set(widget, disposable);
	}

	protected async detachMember(pair: GroupTabsWidget, widget: Widget): Promise<void> {
		const record = this.records.get(pair);
		if (!record || !record.members.has(widget)) {
			return;
		}

		record.memberDisposables.get(widget)?.dispose();
		record.memberDisposables.delete(widget);
		record.members.delete(widget);
		record.placements.delete(widget);
		this.pairByChild.delete(widget);

		if (pair.containsPane(widget)) {
			pair.detachPane(widget);
		}

		if (record.members.size === 0) {
			this.clearPair(pair);
			pair.dispose();
			return;
		}
		if (record.members.size === 1) {
			await this.unwrapSingle(pair);
			return;
		}

		record.primary = pair.primary ?? [...record.members][0];
	}

	protected async unwrapSingle(pair: GroupTabsWidget): Promise<void> {
		const record = this.records.get(pair);
		if (!record || record.members.size !== 1 || pair.isDisposed) {
			return;
		}
		const remaining = [...record.members][0];
		const current = this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title;
		if (pair.containsPane(remaining)) {
			pair.detachPane(remaining);
		}
		await this.withoutShellCapture(() => this.shell.addWidget(remaining, {
			area: 'main',
			ref: pair,
			mode: 'tab-after'
		}));
		this.clearPair(pair);
		pair.dispose();
		if (current) {
			await this.shell.activateWidget(remaining.id);
		}
	}

	protected readopt(pair: GroupTabsWidget, widget: Widget): void {
		const record = this.records.get(pair);
		if (!record || pair.isDisposed || widget.isDisposed || pair.containsPane(widget)) {
			return;
		}

		const placement = record.placements.get(widget);
		const source = placement?.ref && record.members.has(placement.ref) ? placement.ref : record.primary;
		pair.addRelativePane(widget, source, placement?.relation ?? 'split-right');
		this.redeliverWebviewContent(widget);
		void this.shell.revealWidget(widget.id);
	}

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

	protected clearPair(pair: GroupTabsWidget): void {
		const record = this.records.get(pair);
		if (!record) {
			return;
		}
		for (const widget of record.members) {
			this.pairByChild.delete(widget);
		}
		for (const disposable of record.memberDisposables.values()) {
			disposable.dispose();
		}
		record.memberDisposables.clear();
		record.toDispose.dispose();
		this.records.delete(pair);
	}

	protected async withoutShellCapture<T>(action: () => Promise<T>): Promise<T> {
		this.suppressShellCapture++;
		try {
			return await action();
		} finally {
			this.suppressShellCapture--;
		}
	}
}
