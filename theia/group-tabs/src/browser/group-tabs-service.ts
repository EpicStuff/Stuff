import { Disposable, DisposableCollection, generateUuid } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ApplicationShell, DockLayout, DockPanel, Widget, WidgetManager } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { Message, MessageLoop } from '@theia/core/shared/@lumino/messaging';
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
	closingActive?: Widget;
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

	resolveSource(widget: Widget | null | undefined): Widget | undefined {
		if (widget instanceof GroupTabsWidget) {
			return this.getPrimary(widget);
		}
		return widget ?? undefined;
	}

	getMembers(widget: Widget | undefined): Widget[] {
		const pair = this.getPair(widget);
		return pair ? [...(this.records.get(pair)?.members ?? pair.getTrackableWidgets())] : widget ? [widget] : [];
	}

	async groupManual(primaryInput: Widget, widgets: Widget[]): Promise<GroupTabsWidget | undefined> {
		const existingMembers = this.getMembers(primaryInput);
		const family = [...new Set([...existingMembers, primaryInput, ...widgets].filter(widget => !widget.isDisposed))];
		if (family.length < 2) {
			return this.getPair(primaryInput);
		}

		const familySet = new Set(family);
		const preferred = this.getPrimary(primaryInput) ?? primaryInput;
		const roots = family.filter(widget => {
			const ref = this.resolveSource(this.provenance.get(widget)?.ref);
			return !ref || !familySet.has(ref);
		});
		const primary = roots.length === 1
			? roots[0]
			: roots.includes(preferred)
				? preferred
				: roots[0] ?? preferred;

		const resolved = new Set<Widget>(this.getMembers(primary));
		resolved.add(primary);
		const pending = family.filter(widget => widget !== primary && !resolved.has(widget));
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
				relation
			}, {
				restoreSecondary: !this.isMiniBrowserUrlPreview(child)
			});

			if (placement?.ref && rememberedRef && source === rememberedRef) {
				const rememberedRule = await this.learnRule(source, child, relation);
				if (rememberedRule) {
					pair.addRememberedRule(rememberedRule);
				}
			}
			resolved.add(child);
		}
		return pair;
	}

	async groupLayout(layout: DockPanel.ILayoutConfig): Promise<GroupTabsWidget | undefined> {
		const widgets = this.layoutWidgets(layout).filter(widget => !widget.isDisposed);
		if (widgets.length < 2) {
			return widgets[0] ? this.getPair(widgets[0]) : undefined;
		}

		const existingPair = widgets.map(widget => this.getPair(widget)).find((pair): pair is GroupTabsWidget => !!pair);
		if (existingPair) {
			return this.groupManual(widgets[0], widgets.slice(1));
		}

		const primary = widgets[0];
		const pair = await this.createGroupContainer(primary);
		for (const widget of widgets) {
			if (this.shell.getAreaFor(widget)) {
				widget.parent = null;
			}
		}

		pair.setGroupLayout(layout);
		this.registerPair(pair);

		const family = new Set(widgets);
		for (const widget of widgets) {
			const placement = this.provenance.get(widget);
			if (placement) {
				this.registerMember(pair, widget, placement);
				const source = this.resolveSource(placement.ref);
				if (source && family.has(source)) {
					const rememberedRule = await this.learnRule(source, widget, placement.relation);
					if (rememberedRule) {
						pair.addRememberedRule(rememberedRule);
					}
				}
			}
			if (widget !== primary && this.isMiniBrowserUrlPreview(widget)) {
				pair.markTransient(widget);
			}
			this.redeliverWebviewContent(widget);
		}
		await this.shell.activateWidget(primary.id);
		return pair;
	}

	async ungroup(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		const record = pair && this.records.get(pair);
		if (!pair || !record) {
			return;
		}

		await this.forgetRules(pair, record);
		const layout = this.pruneLayout(pair.getGroupLayout());
		const primary = record.primary;
		pair.releasePanes();

		const first = this.firstLayoutWidget(layout.main);
		if (!first) {
			this.clearPair(pair);
			pair.dispose();
			return;
		}

		await this.withoutShellCapture(() => this.shell.addWidget(first, {
			area: 'main',
			ref: pair,
			mode: 'tab-after'
		}));

		this.clearPair(pair);
		pair.dispose();
		await this.populateLayout(layout.main);

		if (!primary.isDisposed) {
			await this.shell.activateWidget(primary.id);
		}
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

	async closeSecondary(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		const record = pair && this.records.get(pair);
		if (!pair || !record) {
			return;
		}
		const secondary = [...record.members].reverse().find(member => member !== record.primary);
		if (secondary && !secondary.isDisposed) {
			secondary.close();
		}
	}

	noteMiniBrowserUrlPreview(widget: MiniBrowser, sourceInput: Widget | undefined, collapseRightAfterGrouping = false): void {
		const source = this.resolveSource(sourceInput);
		if (!source || source === widget || source.isDisposed) {
			return;
		}
		this.provenance.set(widget, {
			ref: source,
			relation: MINI_BROWSER_URL_PREVIEW_RELATION
		});
		setTimeout(() => {
			void this.maybeAutoGroup(widget, collapseRightAfterGrouping);
		}, 0);
	}

	async adoptRestored(): Promise<void> {
		for (const pair of this.shell.getWidgets('main')) {
			if (!(pair instanceof GroupTabsWidget) || this.records.has(pair)) {
				continue;
			}
			const panes = pair.getTrackableWidgets();
			const pane = panes[0];
			if (panes.length >= 2 || (pane && this.shouldKeepIncompleteGroup(pane))) {
				this.registerPair(pair);
				continue;
			}

			const current = this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title;
			const active = this.shell.activeWidget === pair || this.shell.activeWidget === pane;
			if (pane) {
				pair.detachPane(pane);
				await this.withoutShellCapture(() => this.shell.addWidget(pane, { area: 'main', ref: pair, mode: 'tab-after' }));
			}
			pair.dispose();
			if (active && pane) {
				await this.shell.activateWidget(pane.id);
			} else if (current && pane) {
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

			await original(widget, options);

			const existingPair = this.getPair(widget);
			if (existingPair) {
				setTimeout(() => this.readopt(existingPair, widget), 0);
				return;
			}

			if (ref && ref !== widget) {
				this.provenance.set(widget, { ref, relation });
				setTimeout(() => {
					void this.maybeAutoGroup(widget);
				}, 0);
			}
		};
	}

	protected async maybeAutoGroup(widget: Widget, collapseRightAfterGrouping = false): Promise<void> {
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

		const area = this.shell.getAreaFor(widget);
		const rememberedUrlPreview = this.isMiniBrowserUrlPreview(widget)
			&& placement.relation === MINI_BROWSER_URL_PREVIEW_RELATION;
		if (area !== 'main' && !(rememberedUrlPreview && area === 'right')) {
			return;
		}

		try {
			const pair = await this.addRelative(source, widget, placement, {
				restoreSecondary: !rememberedUrlPreview
			});
			pair.addRememberedRule(this.ruleKey(rule));
			if (rememberedUrlPreview && collapseRightAfterGrouping) {
				await this.shell.collapsePanel('right');
			}
		} catch (error) {
			console.error('Failed to restore remembered tab group', error);
		}
	}

	protected async learnRule(parent: Widget, child: Widget, relation: string): Promise<string | undefined> {
		if (!this.rememberGroupsEnabled()) {
			return undefined;
		}
		const rule: LearnedGroupRule = {
			parentKind: this.widgetKind(parent),
			childKind: this.widgetKind(child),
			relation
		};
		const key = this.ruleKey(rule);
		if (!this.learnedRules.some(candidate => this.ruleKey(candidate) === key)) {
			this.learnedRules.push(rule);
			await this.storageService.setData(LEARNED_RULES_STORAGE_KEY, this.learnedRules);
		}
		return key;
	}

	protected async forgetRules(pair: GroupTabsWidget, record: GroupTabsRecord): Promise<void> {
		const members = new Set(record.members);
		const removed = new Set(pair.getRememberedRules());
		for (const [child, placement] of record.placements) {
			const parent = this.resolveSource(placement.ref);
			if (!parent || !members.has(parent)) {
				continue;
			}
			removed.add(this.ruleKey({
				parentKind: this.widgetKind(parent),
				childKind: this.widgetKind(child),
				relation: placement.relation
			}));
		}
		if (removed.size === 0) {
			return;
		}
		this.learnedRules = this.learnedRules.filter(rule => !removed.has(this.ruleKey(rule)));
		await this.storageService.setData(LEARNED_RULES_STORAGE_KEY, this.learnedRules);
	}

	protected ruleKey(rule: LearnedGroupRule): string {
		return `${rule.parentKind}\n${rule.childKind}\n${rule.relation}`;
	}

	protected shouldKeepIncompleteGroup(primary: Widget): boolean {
		if (!this.rememberGroupsEnabled()) {
			return false;
		}
		const parentKind = this.widgetKind(primary);
		return this.learnedRules.some(rule =>
			rule.parentKind === parentKind
			&& rule.childKind === 'mini-browser:url-preview'
			&& rule.relation === MINI_BROWSER_URL_PREVIEW_RELATION
		);
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

	protected layoutWidgets(layout: DockPanel.ILayoutConfig): Widget[] {
		return this.areaWidgets(layout.main);
	}

	protected areaWidgets(area: DockLayout.AreaConfig | null): Widget[] {
		if (!area) {
			return [];
		}
		if (area.type === 'tab-area') {
			return [...area.widgets];
		}
		return area.children.flatMap(child => this.areaWidgets(child));
	}

	protected firstLayoutWidget(area: DockLayout.AreaConfig | null): Widget | undefined {
		if (!area) {
			return undefined;
		}
		if (area.type === 'tab-area') {
			return area.widgets.find(widget => !widget.isDisposed);
		}
		for (const child of area.children) {
			const widget = this.firstLayoutWidget(child);
			if (widget) {
				return widget;
			}
		}
		return undefined;
	}

	protected pruneLayout(layout: DockPanel.ILayoutConfig): DockPanel.ILayoutConfig {
		return {
			main: this.pruneArea(layout.main)
		};
	}

	protected pruneArea(area: DockLayout.AreaConfig | null): DockLayout.AreaConfig | null {
		if (!area) {
			return null;
		}
		if (area.type === 'tab-area') {
			const widgets = area.widgets.filter(widget => !widget.isDisposed);
			if (widgets.length === 0) {
				return null;
			}
			const selected = area.widgets[area.currentIndex];
			return {
				type: 'tab-area',
				widgets,
				currentIndex: Math.max(0, widgets.indexOf(selected))
			};
		}

		const children: DockLayout.AreaConfig[] = [];
		const sizes: number[] = [];
		for (let index = 0; index < area.children.length; index++) {
			const child = this.pruneArea(area.children[index]);
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

	protected async populateLayout(area: DockLayout.AreaConfig | null): Promise<void> {
		if (!area) {
			return;
		}
		if (area.type === 'tab-area') {
			const anchor = this.firstLayoutWidget(area);
			if (!anchor) {
				return;
			}
			for (const widget of area.widgets) {
				if (widget !== anchor && !widget.isDisposed && this.shell.getAreaFor(widget) !== 'main') {
					await this.withoutShellCapture(() => this.shell.addWidget(widget, {
						area: 'main',
						ref: anchor,
						mode: 'tab-after'
					}));
				}
			}
			return;
		}

		const anchors = area.children.map(child => this.firstLayoutWidget(child));
		let previous = anchors[0];
		for (let index = 1; index < area.children.length; index++) {
			const anchor = anchors[index];
			if (!anchor || !previous) {
				continue;
			}
			if (this.shell.getAreaFor(anchor) !== 'main') {
				await this.withoutShellCapture(() => this.shell.addWidget(anchor, {
					area: 'main',
					ref: previous,
					mode: area.orientation === 'horizontal' ? 'split-right' : 'split-bottom'
				}));
			}
			previous = anchor;
		}

		for (const child of area.children) {
			await this.populateLayout(child);
		}
	}

	protected async createGroup(primary: Widget): Promise<GroupTabsWidget> {
		const pair = await this.createGroupContainer(primary);
		primary.parent = null;
		pair.addRootPane(primary);
		this.registerPair(pair);
		this.redeliverWebviewContent(primary);
		return pair;
	}

	protected async createGroupContainer(ref: Widget): Promise<GroupTabsWidget> {
		const primaryArea = this.shell.getAreaFor(ref);
		if (primaryArea !== 'main') {
			throw new Error('Group Tabs requires the source widget to be in the main area');
		}

		const pair = await this.widgetManager.getOrCreateWidget<GroupTabsWidget>(GroupTabsWidget.FACTORY_ID, { id: generateUuid() });
		await this.withoutShellCapture(() => this.shell.addWidget(pair, {
			area: 'main',
			ref,
			mode: 'tab-after'
		}));
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
		// The shell moves the outer selection off the group when the active pane is closed.
		const onMessage = (_: unknown, msg: Message): boolean => {
			if (msg.type === 'close-request' && this.shell.activeWidget === widget && this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title) {
				record.closingActive = widget;
			}
			return true;
		};
		MessageLoop.installMessageHook(widget, onMessage);
		const disposable = Disposable.create(() => {
			widget.disposed.disconnect(onDisposed);
			MessageLoop.removeMessageHook(widget, onMessage);
		});
		record.memberDisposables.set(widget, disposable);
	}

	protected async detachMember(pair: GroupTabsWidget, widget: Widget): Promise<void> {
		const record = this.records.get(pair);
		if (!record || !record.members.has(widget)) {
			return;
		}

		const reselect = record.closingActive === widget;
		if (reselect) {
			record.closingActive = undefined;
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
			await this.unwrapSingle(pair, reselect);
			return;
		}

		record.primary = pair.primary ?? [...record.members][0];
		if (reselect) {
			await this.shell.activateWidget(pair.id);
		}
	}

	protected async unwrapSingle(pair: GroupTabsWidget, reselect: boolean): Promise<void> {
		const record = this.records.get(pair);
		if (!record || record.members.size !== 1 || pair.isDisposed) {
			return;
		}
		const remaining = [...record.members][0];
		const current = reselect || this.shell.mainPanel.findTabBar(pair.title)?.currentTitle === pair.title;
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
