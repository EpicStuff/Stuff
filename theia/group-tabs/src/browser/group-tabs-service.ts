import { Disposable, DisposableCollection, generateUuid } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ApplicationShell, DockLayout, DockPanel, Widget, WidgetManager } from '@theia/core/lib/browser';
import { LocalStorageService } from '@theia/core/lib/browser/storage-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { Message, MessageLoop } from '@theia/core/shared/@lumino/messaging';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { WebviewMessageChannels, WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { GROUP_TABS_REMEMBER_GROUPS } from './group-tabs-preferences';
import { GroupTabsWidget } from './group-tabs-widget';

const TEMPLATES_STORAGE_KEY = 'group-tabs.templates';
export const MINI_BROWSER_URL_PREVIEW_RELATION = 'mini-browser-url-preview';

// A slot without a how matches any tab of its kind, and a tab without a how fills any slot of its kind.
interface TemplateSlot {
	kind: string;
	how?: string;
}

type TemplateArea = {
	type: 'tab-area';
	slots: number[];
	currentIndex: number;
} | {
	type: 'split-area';
	orientation: 'horizontal' | 'vertical';
	children: TemplateArea[];
	sizes: number[];
};

interface GroupTemplate {
	slots: TemplateSlot[];
	layout: TemplateArea;
}

interface GroupTabsRecord {
	primary: Widget;
	members: Set<Widget>;
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

	// Templates are device wide; the injected StorageService is per workspace in this app.
	@inject(LocalStorageService)
	protected readonly storageService!: LocalStorageService;

	@inject(PreferenceService)
	protected readonly preferenceService!: PreferenceService;

	protected readonly pairByChild = new WeakMap<Widget, GroupTabsWidget>();
	protected readonly records = new Map<GroupTabsWidget, GroupTabsRecord>();
	protected readonly hows = new WeakMap<Widget, string>();
	protected readonly openOrder = new WeakMap<Widget, number>();
	// The shell's own focus tracker is private, so recency is tracked here.
	protected readonly recency = new WeakMap<Widget, number>();
	protected sequence = 0;
	protected templates: GroupTemplate[] = [];
	protected autoGroupQueue = Promise.resolve();
	protected started = false;
	protected suppressShellCapture = 0;

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		const stored = await this.storageService.getData<GroupTemplate[]>(TEMPLATES_STORAGE_KEY, []);
		this.templates = Array.isArray(stored)
			? stored.filter(template => Array.isArray(template?.slots)
				&& template.slots.length > 1
				&& template.slots.every(slot => typeof slot?.kind === 'string')
				&& typeof template.layout?.type === 'string')
			: [];
		this.shell.onDidChangeActiveWidget(({ newValue }) => {
			if (newValue) {
				this.recency.set(newValue, ++this.sequence);
			}
		});
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
		const primary = this.getPrimary(primaryInput) ?? primaryInput;
		const family = [...new Set([...this.getMembers(primary), primary, ...widgets].filter(widget => !widget.isDisposed))];
		if (family.length < 2) {
			return this.getPair(primary);
		}

		let pair = this.getPair(primary);
		for (const child of family) {
			if (child !== primary) {
				pair = await this.addRelative(primary, child, this.hows.get(child) ?? 'split-right', {
					restoreSecondary: !this.isMiniBrowserUrlPreview(child)
				});
			}
		}
		if (pair) {
			await this.learnTemplate(pair);
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
			return this.groupManual(this.getPrimary(existingPair) ?? widgets[0], widgets);
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
		for (const widget of widgets) {
			if (widget !== primary && this.isMiniBrowserUrlPreview(widget)) {
				pair.markTransient(widget);
			}
			this.redeliverWebviewContent(widget);
		}
		await this.learnTemplate(pair);
		await this.shell.activateWidget(primary.id);
		return pair;
	}

	async ungroup(widget: Widget | undefined): Promise<void> {
		const pair = this.getPair(widget);
		const record = pair && this.records.get(pair);
		if (!pair || !record) {
			return;
		}

		await this.forgetTemplate(pair);
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

	async addRelative(sourceInput: Widget, widget: Widget, relation: string, options: { restoreSecondary?: boolean } = {}): Promise<GroupTabsWidget> {
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
		pair.addRelativePane(widget, source, relation);
		this.registerMember(pair, widget);
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
		this.hows.set(widget, MINI_BROWSER_URL_PREVIEW_RELATION);
		this.maybeAutoGroup(widget, source && source !== widget && !source.isDisposed ? source : undefined, collapseRightAfterGrouping);
	}

	async adoptRestored(): Promise<void> {
		for (const pair of this.shell.getWidgets('main')) {
			if (!(pair instanceof GroupTabsWidget) || this.records.has(pair)) {
				continue;
			}
			const panes = pair.getTrackableWidgets();
			const pane = panes[0];
			if (panes.length >= 2 || (pane && this.shouldKeepIncompleteGroup(pair, pane))) {
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

			const area = this.shell.getInsertionOptions(options).area;
			const how = area !== 'main' ? `area:${area}` : options?.mode ? String(options.mode) : 'open';

			await original(widget, options);

			const existingPair = this.getPair(widget);
			if (existingPair) {
				setTimeout(() => this.readopt(existingPair, widget), 0);
				return;
			}

			this.hows.set(widget, how);
			this.openOrder.set(widget, ++this.sequence);
			this.recency.set(widget, this.sequence);
			if (this.shell.getAreaFor(widget) === 'main') {
				this.maybeAutoGroup(widget);
			}
		};
	}

	// Runs one at a time so tabs opened together are not claimed by two groups.
	protected maybeAutoGroup(widget: Widget, source?: Widget, collapseRightAfterGrouping = false): void {
		setTimeout(() => {
			this.autoGroupQueue = this.autoGroupQueue
				.then(() => this.autoGroup(widget, source, collapseRightAfterGrouping))
				.catch(error => console.error('Failed to apply remembered tab group', error));
		}, 0);
	}

	protected async autoGroup(widget: Widget, source: Widget | undefined, collapseRightAfterGrouping: boolean): Promise<void> {
		if (!this.rememberGroupsEnabled() || widget.isDisposed || this.templates.length === 0) {
			return;
		}
		const urlPreview = this.isMiniBrowserUrlPreview(widget) && this.hows.get(widget) === MINI_BROWSER_URL_PREVIEW_RELATION;
		const area = this.shell.getAreaFor(widget);
		if (area !== 'main' && !(urlPreview && area === 'right')) {
			return;
		}
		const widgetPair = this.getPair(widget);
		if (widgetPair && (!urlPreview || (source && widgetPair === this.getPair(source)))) {
			return;
		}

		let pair: GroupTabsWidget | undefined;
		const sourcePair = source && this.getPair(source);
		if (sourcePair) {
			// A restored group that lost its URL preview takes the preview back.
			const template = this.templates.find(candidate => this.templateKey(candidate.slots) === sourcePair.getTemplateKey());
			const members = this.getMembers(sourcePair);
			const assigned = urlPreview && template && template.slots.length === members.length + 1
				? this.matchTemplate(template, [widget, ...members], members.length + 1)
				: undefined;
			if (!template || !assigned) {
				return;
			}
			pair = await this.applyTemplate(template, assigned, sourcePair);
		} else {
			const ungrouped = this.shell.getWidgets('main').filter(candidate =>
				candidate !== widget && candidate !== source && !candidate.isDisposed && !(candidate instanceof GroupTabsWidget) && !this.getPair(candidate));
			ungrouped.sort((a, b) => (this.recency.get(b) ?? 0) - (this.recency.get(a) ?? 0));
			// A preview shows its source, so a preview group must include that source.
			const required = source && this.shell.getAreaFor(source) === 'main' && !(source instanceof GroupTabsWidget) ? [widget, source] : [widget];
			const candidates = [...required, ...ungrouped];
			for (const template of [...this.templates].reverse()) {
				const assigned = this.matchTemplate(template, candidates, required.length);
				if (assigned) {
					pair = await this.applyTemplate(template, assigned);
					break;
				}
			}
		}
		if (!pair) {
			return;
		}

		const first = this.getMembers(pair).reduce((a, b) => this.openedAt(b) < this.openedAt(a) ? b : a, widget);
		await this.shell.activateWidget(first.id);
		if (urlPreview && collapseRightAfterGrouping) {
			await this.shell.collapsePanel('right');
		}
	}

	// Returns the chosen widgets by slot index, or undefined when the slots cannot all be filled.
	protected matchTemplate(template: GroupTemplate, candidates: Widget[], required: number): Widget[] | undefined {
		const slots = template.slots;
		const kinds = candidates.map(candidate => this.widgetKind(candidate));
		const hows = candidates.map(candidate => this.hows.get(candidate));
		const fits = (candidate: number, slot: number): boolean => kinds[candidate] === slots[slot].kind
			&& (hows[candidate] === undefined || slots[slot].how === undefined || hows[candidate] === slots[slot].how);
		const owners: (number | undefined)[] = slots.map(() => undefined);
		// Kuhn's augmenting paths, taking candidates in priority order so the most recent tabs win.
		const augment = (candidate: number, seen: Set<number>): boolean => {
			for (let slot = 0; slot < slots.length; slot++) {
				if (seen.has(slot) || !fits(candidate, slot)) {
					continue;
				}
				seen.add(slot);
				const owner = owners[slot];
				if (owner === undefined || augment(owner, seen)) {
					owners[slot] = candidate;
					return true;
				}
			}
			return false;
		};
		let matched = 0;
		for (let candidate = 0; candidate < candidates.length && matched < slots.length; candidate++) {
			if (augment(candidate, new Set())) {
				matched++;
			} else if (candidate < required) {
				return undefined;
			}
		}
		if (matched < slots.length) {
			return undefined;
		}

		// Interchangeable slots take their tabs in opening order, so the oldest lands first in the layout.
		const assigned = owners.map(owner => candidates[owner!]);
		const bySignature = new Map<string, number[]>();
		slots.forEach((slot, index) => {
			const signature = this.slotSignature(slot);
			bySignature.set(signature, [...bySignature.get(signature) ?? [], index]);
		});
		for (const indices of bySignature.values()) {
			const widgets = indices.map(index => assigned[index]).sort((a, b) => (this.openOrder.get(a) ?? 0) - (this.openOrder.get(b) ?? 0));
			indices.forEach((index, position) => assigned[index] = widgets[position]);
		}
		return assigned;
	}

	protected async applyTemplate(template: GroupTemplate, assigned: Widget[], existing?: GroupTabsWidget): Promise<GroupTabsWidget> {
		for (const widget of assigned) {
			const widgetPair = this.getPair(widget);
			if (widgetPair && widgetPair !== existing) {
				await this.detachMember(widgetPair, widget);
			}
		}
		const pair = existing ?? await this.createGroupContainer(assigned.find(widget => this.shell.getAreaFor(widget) === 'main') ?? assigned[0]);
		pair.releasePanes();
		for (const widget of assigned) {
			if (this.shell.getAreaFor(widget)) {
				widget.parent = null;
			}
		}

		pair.setGroupLayout({ main: this.fromTemplateArea(template.layout, assigned) });
		if (existing) {
			for (const widget of assigned) {
				this.registerMember(pair, widget);
			}
		} else {
			this.registerPair(pair);
		}
		for (const widget of assigned) {
			if (widget !== pair.primary && this.isMiniBrowserUrlPreview(widget)) {
				pair.markTransient(widget);
			}
			this.redeliverWebviewContent(widget);
		}
		pair.setTemplateKey(this.templateKey(template.slots));
		return pair;
	}

	// Keeps the slots of the group's own template while its panes still fill them, so a resized layout replaces it under the same key.
	protected async learnTemplate(pair: GroupTabsWidget): Promise<void> {
		if (!this.rememberGroupsEnabled()) {
			return;
		}
		const main = pair.getGroupLayout().main;
		const panes = this.areaWidgets(main);
		const current = this.templates.find(template => this.templateKey(template.slots) === pair.getTemplateKey());
		const assigned = current && current.slots.length === panes.length ? this.matchTemplate(current, panes, panes.length) : undefined;
		const slots: TemplateSlot[] = current && assigned ? current.slots : [];
		const layout = this.toTemplateArea(main, widget => assigned
			? assigned.indexOf(widget)
			: slots.push({ kind: this.widgetKind(widget), how: this.hows.get(widget) }) - 1);
		if (!layout || slots.length < 2) {
			return;
		}
		const key = this.templateKey(slots);
		this.templates = [...this.templates.filter(template => this.templateKey(template.slots) !== key), { slots, layout }];
		await this.storageService.setData(TEMPLATES_STORAGE_KEY, this.templates);
		pair.setTemplateKey(key);
	}

	protected async forgetTemplate(pair: GroupTabsWidget): Promise<void> {
		const key = pair.getTemplateKey();
		const templates = this.templates.filter(template => this.templateKey(template.slots) !== key);
		if (!key || templates.length === this.templates.length) {
			return;
		}
		this.templates = templates;
		await this.storageService.setData(TEMPLATES_STORAGE_KEY, this.templates);
	}

	protected templateKey(slots: TemplateSlot[]): string {
		return JSON.stringify(slots.map(slot => this.slotSignature(slot)).sort());
	}

	protected slotSignature(slot: TemplateSlot): string {
		return `${slot.kind}\n${slot.how ?? ''}`;
	}

	protected toTemplateArea(area: DockLayout.AreaConfig | null, slotOf: (widget: Widget) => number): TemplateArea | undefined {
		if (!area) {
			return undefined;
		}
		if (area.type === 'tab-area') {
			return {
				type: 'tab-area',
				slots: area.widgets.map(widget => slotOf(widget)),
				currentIndex: area.currentIndex
			};
		}
		return {
			type: 'split-area',
			orientation: area.orientation,
			children: area.children.map(child => this.toTemplateArea(child, slotOf)!),
			sizes: [...area.sizes]
		};
	}

	protected fromTemplateArea(area: TemplateArea, assigned: Widget[]): DockLayout.AreaConfig {
		if (area.type === 'tab-area') {
			return {
				type: 'tab-area',
				widgets: area.slots.map(slot => assigned[slot]),
				currentIndex: area.currentIndex
			};
		}
		return {
			type: 'split-area',
			orientation: area.orientation,
			children: area.children.map(child => this.fromTemplateArea(child, assigned)),
			sizes: [...area.sizes]
		};
	}

	// A one-pane group survives a restart only when its template can refill it with a URL preview.
	protected shouldKeepIncompleteGroup(pair: GroupTabsWidget, pane: Widget): boolean {
		if (!this.rememberGroupsEnabled()) {
			return false;
		}
		const template = this.templates.find(candidate => this.templateKey(candidate.slots) === pair.getTemplateKey());
		const lasting = template?.slots.filter(slot => slot.how !== MINI_BROWSER_URL_PREVIEW_RELATION) ?? [];
		return !!template && template.slots.length > 1 && lasting.length === 1 && lasting[0].kind === this.widgetKind(pane);
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

	// Tabs restored at startup have no open order, so the first focus stands in for it.
	protected openedAt(widget: Widget): number {
		return this.openOrder.get(widget) ?? this.recency.get(widget) ?? 0;
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

	protected registerMember(pair: GroupTabsWidget, widget: Widget): void {
		const record = this.records.get(pair);
		if (!record || record.members.has(widget)) {
			return;
		}

		record.members.add(widget);
		this.pairByChild.set(widget, pair);

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

		pair.addRelativePane(widget, record.primary, 'split-right');
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
