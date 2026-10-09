import {
	CommandMenu,
	CommandRegistry,
	CompoundMenuNode,
	ContextExpressionMatcher,
	Emitter,
	environment,
	Group,
	GroupImpl,
	MenuModelRegistry,
	MenuNode,
	MenuNodeFactory,
	MenuPath,
	PreferenceScope,
	PreferenceService,
	RenderedMenuNode
} from '@theia/core';
import {
	ContextMenuAccess,
	ContextMenuRenderer,
	RenderContextMenuOptions
} from '@theia/core/lib/browser/context-menu-renderer';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { AcceleratorSource } from '@theia/core/lib/browser/menu/action-menu-node';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { PluginMenuCommandAdapter } from '@theia/plugin-ext/lib/main/browser/menus/plugin-menu-command-adapter';
import { PluginContributionHandler } from '@theia/plugin-ext/lib/main/browser/plugin-contribution-handler';
import {
	CONTEXT_MENU_TARGETS,
	CUSTOM_CONTEXT_MENU_LAYOUTS,
	ContextMenuTarget,
	ContextMenuWriteStatus,
	EditableMenuEntry,
	EditableMenuItem,
	EditableMenuSeparator,
	StoredMenuAdd,
	StoredMenuEdit,
	StoredMenuLayout,
	StoredMenuPlacement
} from './custom-context-menu-types';

interface DefaultMenuItem extends EditableMenuItem {
	custom: false;
	node: MenuNode;
	nodeId: string;
}

interface DefaultMenuSeparator extends EditableMenuSeparator {
	custom: false;
	group: string;
}

type DefaultMenuEntry = DefaultMenuItem | DefaultMenuSeparator;

interface ResolvedMenuItem {
	type: 'item';
	node: MenuNode;
}

interface ResolvedMenuSeparator {
	type: 'separator';
}

type ResolvedMenuEntry = ResolvedMenuItem | ResolvedMenuSeparator;

interface EntryLocation {
	entry: EditableMenuEntry;
	parent: EditableMenuEntry[];
	parentKey: string | null;
	index: number;
}

let rendererPatched = false;
let activeService: CustomContextMenuService | undefined;

@injectable()
export class CustomContextMenuService {
	@inject(MenuModelRegistry)
	protected readonly menuRegistry!: MenuModelRegistry;

	@inject(MenuNodeFactory)
	protected readonly menuNodeFactory!: MenuNodeFactory;

	@inject(CommandRegistry)
	protected readonly commandRegistry!: CommandRegistry;

	@inject(PreferenceService)
	protected readonly preferenceService!: PreferenceService;

	@inject(KeybindingRegistry)
	protected readonly keybindingRegistry!: KeybindingRegistry;

	@inject(PluginContributionHandler)
	protected readonly pluginContributionHandler!: PluginContributionHandler;

	@inject(PluginMenuCommandAdapter)
	protected readonly pluginMenuCommandAdapter!: PluginMenuCommandAdapter;

	protected readonly pendingValues = new Map<string, unknown>();
	protected writeTimer: ReturnType<typeof setTimeout> | undefined;
	protected writing = Promise.resolve();

	protected readonly onDidChangeEmitter = new Emitter<void>();
	/**
	 * Fires when contributed menus, the stored layouts, or edits that are not written yet change.
	 */
	readonly onDidChange = this.onDidChangeEmitter.event;

	protected readonly onDidChangeWriteStatusEmitter = new Emitter<ContextMenuWriteStatus>();
	readonly onDidChangeWriteStatus = this.onDidChangeWriteStatusEmitter.event;

	@postConstruct()
	protected init(): void {
		this.menuRegistry.onDidChange(() => this.onDidChangeEmitter.fire());
		this.commandRegistry.onCommandsChanged(() => this.onDidChangeEmitter.fire());
		this.preferenceService.onPreferenceChanged(change => {
			if (change.preferenceName === CUSTOM_CONTEXT_MENU_LAYOUTS) {
				this.onDidChangeEmitter.fire();
			}
		});
	}

	installRendererPatch(): void {
		activeService = this;
		if (rendererPatched) {
			return;
		}
		rendererPatched = true;

		const originalRender = ContextMenuRenderer.prototype.render;
		ContextMenuRenderer.prototype.render = function (this: ContextMenuRenderer, options: RenderContextMenuOptions): ContextMenuAccess {
			const service = activeService;
			if (!service) {
				return originalRender.call(this, options);
			}

			const sourceMenu = options.menu ?? service.getMenu(options.menuPath);
			if (!sourceMenu) {
				return originalRender.call(this, options);
			}

			let customizedMenu: CompoundMenuNode;
			try {
				customizedMenu = service.customize(options.menuPath, sourceMenu);
			} catch (error) {
				console.error('Custom Context Menu: failed to apply the stored layout, showing the default menu.', error);
				return originalRender.call(this, options);
			}
			if (customizedMenu === sourceMenu) {
				return originalRender.call(this, options);
			}

			return originalRender.call(this, {
				...options,
				menu: customizedMenu
			});
		};
	}

	getTargets(): readonly ContextMenuTarget[] {
		return CONTEXT_MENU_TARGETS;
	}

	getTarget(targetId: string): ContextMenuTarget | undefined {
		return CONTEXT_MENU_TARGETS.find(target => target.id === targetId);
	}

	getMenu(menuPath: MenuPath): CompoundMenuNode | undefined {
		return this.menuRegistry.getMenu(menuPath);
	}

	getDefaultEntries(targetId: string): EditableMenuEntry[] {
		const snapshot = this.getDefaultSnapshot(targetId);
		return snapshot ? this.toEditableEntries(snapshot) : [];
	}

	getEntries(targetId: string): EditableMenuEntry[] {
		const snapshot = this.getDefaultSnapshot(targetId);
		if (!snapshot) {
			return [];
		}

		const defaults = this.toEditableEntries(snapshot);
		const layout = this.getStoredLayout(targetId);
		return layout
			? this.applyLayoutToEditable(defaults, layout)
			: defaults;
	}

	/**
	 * Applies an edit to the current contributed menu plus the stored layout and stores the difference from
	 * the defaults contributed right now. Returns false when nothing changed.
	 */
	updateEntries(targetId: string, mutate: (entries: EditableMenuEntry[]) => boolean): boolean {
		const snapshot = this.getDefaultSnapshot(targetId);
		if (!snapshot) {
			return false;
		}

		const defaults = this.toEditableEntries(snapshot);
		const stored = this.getStoredLayout(targetId);
		const entries = stored
			? this.applyLayoutToEditable(defaults, stored)
			: this.cloneEntries(defaults);
		if (!mutate(entries)) {
			return false;
		}

		const layout = this.createSparseLayout(defaults, entries);
		const value = this.isLayoutEmpty(layout) ? undefined : layout;
		if (JSON.stringify(value) === JSON.stringify(this.getStoredValue(targetId))) {
			return false;
		}
		this.setStoredValue(targetId, value);
		return true;
	}

	/**
	 * The raw stored value for one target, including edits that are not written yet.
	 */
	getStoredValue(targetId: string): unknown {
		if (this.pendingValues.has(targetId)) {
			return this.pendingValues.get(targetId);
		}
		const layouts = this.preferenceService.get<unknown>(CUSTOM_CONTEXT_MENU_LAYOUTS, {});
		return this.isRecord(layouts) ? layouts[targetId] : undefined;
	}

	/**
	 * Stores a raw value for one target, `undefined` removes it. Bursts of edits are coalesced into one write.
	 */
	setStoredValue(targetId: string, value: unknown): void {
		this.pendingValues.set(targetId, value);
		this.onDidChangeEmitter.fire();
		this.onDidChangeWriteStatusEmitter.fire({ saving: true });
		clearTimeout(this.writeTimer);
		this.writeTimer = setTimeout(() => {
			this.writeTimer = undefined;
			this.writing = this.writing.then(() => this.writePendingValues());
		}, 250);
	}

	protected async writePendingValues(): Promise<void> {
		if (!this.pendingValues.size) {
			return;
		}
		const written = new Map(this.pendingValues);
		// Only the user scope is written, and targets without pending edits keep their raw values.
		const current = this.preferenceService.inspect(CUSTOM_CONTEXT_MENU_LAYOUTS)?.globalValue;
		const layouts: Record<string, unknown> = this.isRecord(current) ? { ...current } : {};
		for (const [targetId, value] of written) {
			if (value === undefined) {
				delete layouts[targetId];
			} else {
				layouts[targetId] = value;
			}
		}

		let error: string | undefined;
		try {
			await this.preferenceService.set(CUSTOM_CONTEXT_MENU_LAYOUTS, layouts, PreferenceScope.User);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			console.error('Custom Context Menu: failed to write customContextMenu.layouts.', cause);
		}
		for (const [targetId, value] of written) {
			if (this.pendingValues.get(targetId) === value) {
				this.pendingValues.delete(targetId);
			}
		}
		this.onDidChangeEmitter.fire();
		this.onDidChangeWriteStatusEmitter.fire({ saving: this.pendingValues.size > 0, error });
	}

	customize(menuPath: MenuPath, menu: CompoundMenuNode): CompoundMenuNode {
		const target = CONTEXT_MENU_TARGETS.find(candidate => this.pathsEqual(candidate.path, menuPath));
		if (!target) {
			return menu;
		}

		const layout = this.getStoredLayout(target.id);
		if (!layout) {
			return menu;
		}

		const snapshot = this.buildDefaultSnapshot(menu, target.path);
		const defaults = this.toEditableEntries(snapshot);
		const desired = this.applyLayoutToEditable(defaults, layout);
		const nodes = this.collectDefaultNodes(snapshot);
		const resolved = this.resolveEditableEntries(desired, nodes);
		return this.cloneCompoundWithResolvedEntries(menu, resolved, `root-${target.id}`);
	}

	protected getDefaultSnapshot(targetId: string): DefaultMenuEntry[] | undefined {
		const target = this.getTarget(targetId);
		const menu = target && this.menuRegistry.getMenu(target.path);
		if (!target || !menu) {
			return undefined;
		}
		return this.buildDefaultSnapshot(menu, target.path);
	}

	protected buildDefaultSnapshot(menu: CompoundMenuNode, menuPath: MenuPath): DefaultMenuEntry[] {
		const entries = this.flattenChildren(menu.children, menuPath, []);
		return this.sanitizeDefaultSeparators(entries);
	}

	protected getStoredLayout(targetId: string): StoredMenuLayout | undefined {
		return this.sanitizeLayout(this.getStoredValue(targetId));
	}

	protected sanitizeLayout(value: unknown): StoredMenuLayout | undefined {
		if (!this.isRecord(value) || 'entries' in value || 'knownDefaultKeys' in value) {
			return undefined;
		}

		const layout: StoredMenuLayout = {};
		if (Array.isArray(value.hide)) {
			layout.hide = value.hide.filter((key): key is string => typeof key === 'string');
		}
		if (this.isRecord(value.edit)) {
			layout.edit = {};
			for (const [storageKey, candidate] of Object.entries(value.edit)) {
				if (this.isRecord(candidate)) {
					layout.edit[storageKey] = this.sanitizeStoredFields(candidate);
				}
			}
		}
		if (this.isRecord(value.add)) {
			layout.add = {};
			for (const [storageKey, candidate] of Object.entries(value.add)) {
				if (!this.isRecord(candidate)) {
					continue;
				}
				const fields = this.sanitizeStoredFields(candidate);
				if (candidate.type === 'separator') {
					delete fields.label;
					delete fields.when;
					delete fields.icon;
					layout.add[storageKey] = { ...fields, type: 'separator' };
				} else if (candidate.type === 'submenu' && fields.label) {
					layout.add[storageKey] = { ...fields, type: 'submenu', label: fields.label };
				} else if (candidate.type === 'command' && typeof candidate.command === 'string' && candidate.command) {
					layout.add[storageKey] = { ...fields, type: 'command', command: candidate.command };
				}
			}
		}
		return layout;
	}

	protected sanitizeStoredFields(value: Record<string, unknown>): StoredMenuEdit {
		const fields: StoredMenuEdit = {};
		for (const name of ['label', 'group', 'before', 'after', 'beforeGroup', 'afterGroup'] as const) {
			const field = value[name];
			if (typeof field === 'string') {
				fields[name] = field;
			}
		}
		for (const name of ['parent', 'when', 'icon'] as const) {
			const field = value[name];
			if (typeof field === 'string' || field === null) {
				fields[name] = field;
			}
		}
		if (value.at === 'start' || value.at === 'end') {
			fields.at = value.at;
		}
		return fields;
	}

	protected isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	protected createSparseLayout(defaults: EditableMenuEntry[], desired: EditableMenuEntry[]): StoredMenuLayout {
		const layout: StoredMenuLayout = {};
		const defaultLocations = this.collectLocations(defaults);
		const desiredLocations = this.collectLocations(desired);

		const hidden = this.collectHiddenKeys(defaults, desiredLocations);
		if (hidden.length) {
			layout.hide = hidden;
		}

		const edits: Record<string, StoredMenuEdit> = {};
		const additions: Record<string, StoredMenuAdd> = {};

		for (const { entry, parentKey } of this.walkEntries(desired)) {
			const defaultLocation = defaultLocations.get(entry.storageKey);
			if (!defaultLocation) {
				additions[entry.storageKey] = this.createStoredAdd(entry, parentKey);
				continue;
			}

			const edit = this.createStoredEdit(defaultLocation.entry, entry, defaultLocation.parentKey, parentKey);
			if (Object.keys(edit).length) {
				edits[entry.storageKey] = edit;
			}
		}

		if (Object.keys(edits).length) {
			layout.edit = edits;
		}
		if (Object.keys(additions).length) {
			layout.add = additions;
		}

		const baseline = this.applyLayoutToEditable(defaults, layout);
		const firstGroups = this.collectFirstGroups(defaults);
		this.addSparsePlacementRules(layout, baseline, desired, firstGroups);

		// Structural placements cannot express every arrangement, for example when the referenced group
		// was hidden or a separator moved into another submenu. Those containers fall back to key anchors.
		const appliedContainers = this.collectContainers(this.applyLayoutToEditable(defaults, layout));
		const mismatched = new Set<string | null>();
		for (const [parentKey, desiredEntries] of this.collectContainers(desired)) {
			const appliedKeys = (appliedContainers.get(parentKey) ?? []).map(entry => entry.storageKey);
			if (!this.arraysEqual(appliedKeys, desiredEntries.map(entry => entry.storageKey))) {
				mismatched.add(parentKey);
				for (const entry of desiredEntries) {
					const stored: StoredMenuPlacement | undefined = layout.add?.[entry.storageKey] ?? layout.edit?.[entry.storageKey];
					if (stored) {
						delete stored.group;
						delete stored.at;
						delete stored.before;
						delete stored.after;
						delete stored.beforeGroup;
						delete stored.afterGroup;
					}
				}
			}
		}
		if (mismatched.size) {
			this.addSparsePlacementRules(layout, baseline, desired, firstGroups, mismatched);
		}

		this.pruneLayout(layout);
		return layout;
	}

	protected collectHiddenKeys(
		entries: EditableMenuEntry[],
		desiredLocations: Map<string, EntryLocation>
	): string[] {
		const hidden: string[] = [];
		for (const entry of entries) {
			if (!desiredLocations.has(entry.storageKey)) {
				hidden.push(entry.storageKey);
				continue;
			}
			if (entry.type === 'item' && entry.children) {
				hidden.push(...this.collectHiddenKeys(entry.children, desiredLocations));
			}
		}
		return hidden;
	}

	protected createStoredEdit(
		defaultEntry: EditableMenuEntry,
		desiredEntry: EditableMenuEntry,
		defaultParent: string | null,
		desiredParent: string | null
	): StoredMenuEdit {
		const edit: StoredMenuEdit = {};

		if (defaultEntry.type === 'item' && desiredEntry.type === 'item') {
			if (desiredEntry.label !== defaultEntry.label) {
				edit.label = desiredEntry.label;
			}
			if ((desiredEntry.when ?? '') !== (defaultEntry.when ?? '')) {
				edit.when = desiredEntry.when ?? null;
			}
			if ((desiredEntry.icon ?? '') !== (defaultEntry.icon ?? '')) {
				edit.icon = desiredEntry.icon ?? null;
			}
		}

		if (defaultParent !== desiredParent) {
			edit.parent = desiredParent;
		}

		return edit;
	}

	protected createStoredAdd(entry: EditableMenuEntry, parentKey: string | null): StoredMenuAdd {
		if (entry.type === 'separator') {
			const add: StoredMenuAdd = {
				type: 'separator'
			};
			if (parentKey !== null) {
				add.parent = parentKey;
			}
			return add;
		}

		if (entry.submenu) {
			const add: StoredMenuAdd = {
				type: 'submenu',
				label: entry.label
			};
			if (entry.when !== undefined) {
				add.when = entry.when;
			}
			if (entry.icon !== undefined) {
				add.icon = entry.icon;
			}
			if (parentKey !== null) {
				add.parent = parentKey;
			}
			return add;
		}

		const commandId = entry.commandId ?? entry.storageKey;
		const add: StoredMenuAdd = {
			type: 'command',
			command: commandId
		};
		const defaultLabel = entry.defaultLabel ?? this.commandRegistry.getCommand(commandId)?.label ?? commandId;
		const defaultIcon = entry.defaultIcon ?? this.commandRegistry.getCommand(commandId)?.iconClass;
		if (entry.label !== defaultLabel) {
			add.label = entry.label;
		}
		if (entry.when !== undefined) {
			add.when = entry.when;
		}
		if ((entry.icon ?? '') !== (defaultIcon ?? '')) {
			add.icon = entry.icon ?? null;
		}
		if (parentKey !== null) {
			add.parent = parentKey;
		}
		return add;
	}

	protected addSparsePlacementRules(
		layout: StoredMenuLayout,
		baseline: EditableMenuEntry[],
		desired: EditableMenuEntry[],
		firstGroups: Map<string | null, string>,
		relativeOnlyContainers?: Set<string | null>
	): void {
		const baselineContainers = this.collectContainers(baseline);
		const desiredContainers = this.collectContainers(desired);

		for (const [parentKey, desiredEntries] of desiredContainers) {
			if (relativeOnlyContainers && !relativeOnlyContainers.has(parentKey)) {
				continue;
			}
			const baselineEntries = baselineContainers.get(parentKey) ?? [];
			const baselineKeys = baselineEntries.map(entry => entry.storageKey);
			const desiredKeys = desiredEntries.map(entry => entry.storageKey);
			if (this.arraysEqual(baselineKeys, desiredKeys)) {
				continue;
			}

			const stable = new Set(this.longestCommonSubsequence(baselineKeys, desiredKeys));
			const placed = new Set<string>();
			for (let index = 0; index < desiredEntries.length; index++) {
				const entry = desiredEntries[index];
				if (stable.has(entry.storageKey)) {
					continue;
				}

				const placement = this.derivePlacement(desiredEntries, index, stable, placed, firstGroups.get(parentKey), !!relativeOnlyContainers);
				this.assignPlacement(layout, entry.storageKey, placement);
				placed.add(entry.storageKey);
			}
		}
	}

	protected derivePlacement(
		entries: EditableMenuEntry[],
		index: number,
		stable: Set<string>,
		placed: Set<string>,
		firstGroup: string | undefined,
		relativeOnly: boolean
	): StoredMenuPlacement {
		const entry = entries[index];
		const targetGroup = this.groupAt(entries, index, firstGroup);
		const defaultGroup = entry.type === 'item' ? entry.defaultGroup : undefined;
		const immediateNext = entries[index + 1];
		const immediatePrevious = entries[index - 1];

		// Consecutive moved entries chain on each other so they replay in order.
		if (immediatePrevious && placed.has(immediatePrevious.storageKey)) {
			return {
				after: immediatePrevious.storageKey
			};
		}

		if (!relativeOnly) {
			if (this.isStructuralSeparator(immediateNext) && (stable.has(immediateNext.storageKey) || placed.has(immediateNext.storageKey))) {
				return {
					beforeGroup: immediateNext.group
				};
			}

			if (this.isStructuralSeparator(immediatePrevious) && (stable.has(immediatePrevious.storageKey) || placed.has(immediatePrevious.storageKey))) {
				return {
					group: immediatePrevious.group,
					at: 'start'
				};
			}

			if (entry.type === 'item' && targetGroup) {
				const bounds = this.findStructuralGroupBounds(entries, index);
				if (bounds && index === bounds.start) {
					return {
						group: targetGroup,
						at: 'start'
					};
				}
				if (bounds && index === bounds.end - 1 && bounds.end === entries.length) {
					return {
						group: targetGroup,
						at: 'end'
					};
				}
			}
		}

		const next = this.findPlacementAnchor(entries, index, 1, stable, placed);
		const previous = this.findPlacementAnchor(entries, index, -1, stable, placed);
		const placement: StoredMenuPlacement = {};

		if (!relativeOnly && targetGroup && targetGroup !== defaultGroup && entry.type === 'item') {
			placement.group = targetGroup;
		}

		if (next) {
			if (!relativeOnly && this.isStructuralSeparator(next)) {
				delete placement.group;
				placement.beforeGroup = next.group;
			} else {
				placement.before = next.storageKey;
			}
			return placement;
		}

		if (previous) {
			if (!relativeOnly && this.isStructuralSeparator(previous)) {
				placement.group = previous.group;
				placement.at = 'start';
			} else {
				placement.after = previous.storageKey;
			}
			return placement;
		}

		placement.at = index === 0 ? 'start' : 'end';
		return placement;
	}

	protected findPlacementAnchor(
		entries: EditableMenuEntry[],
		index: number,
		direction: -1 | 1,
		stable: Set<string>,
		placed: Set<string>
	): EditableMenuEntry | undefined {
		for (let cursor = index + direction; cursor >= 0 && cursor < entries.length; cursor += direction) {
			const candidate = entries[cursor];
			if (stable.has(candidate.storageKey) || placed.has(candidate.storageKey)) {
				return candidate;
			}
		}
		return undefined;
	}

	protected findStructuralGroupBounds(
		entries: EditableMenuEntry[],
		index: number
	): { start: number, end: number } | undefined {
		if (index < 0 || index >= entries.length) {
			return undefined;
		}

		let start = 0;
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			if (this.isStructuralSeparator(entries[cursor])) {
				start = cursor + 1;
				break;
			}
		}

		let end = entries.length;
		for (let cursor = index + 1; cursor < entries.length; cursor++) {
			if (this.isStructuralSeparator(entries[cursor])) {
				end = cursor;
				break;
			}
		}
		return {
			start,
			end
		};
	}

	protected groupAt(entries: EditableMenuEntry[], index: number, firstGroup?: string): string | undefined {
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			const entry = entries[cursor];
			if (this.isStructuralSeparator(entry)) {
				return entry.group;
			}
		}

		return firstGroup;
	}

	protected assignPlacement(layout: StoredMenuLayout, storageKey: string, placement: StoredMenuPlacement): void {
		if (!Object.keys(placement).length) {
			return;
		}
		if (layout.add?.[storageKey]) {
			Object.assign(layout.add[storageKey], placement);
			return;
		}
		layout.edit ??= {};
		Object.assign(layout.edit[storageKey] ??= {}, placement);
	}

	protected pruneLayout(layout: StoredMenuLayout): void {
		if (!layout.hide?.length) {
			delete layout.hide;
		}
		if (layout.edit) {
			for (const [key, edit] of Object.entries(layout.edit)) {
				if (!Object.keys(edit).length) {
					delete layout.edit[key];
				}
			}
			if (!Object.keys(layout.edit).length) {
				delete layout.edit;
			}
		}
		if (layout.add && !Object.keys(layout.add).length) {
			delete layout.add;
		}
	}

	protected isLayoutEmpty(layout: StoredMenuLayout): boolean {
		return !layout.hide?.length
			&& !Object.keys(layout.edit ?? {}).length
			&& !Object.keys(layout.add ?? {}).length;
	}

	protected applyLayoutToEditable(defaults: EditableMenuEntry[], layout: StoredMenuLayout): EditableMenuEntry[] {
		const root = this.cloneEntries(defaults);

		for (const [storageKey, add] of Object.entries(layout.add ?? {})) {
			if (this.findLocation(root, storageKey)) {
				continue;
			}
			root.push(this.createEditableAdd(storageKey, add));
		}

		for (const [storageKey, edit] of Object.entries(layout.edit ?? {})) {
			const location = this.findLocation(root, storageKey);
			if (location?.entry.type === 'item') {
				this.applyEditValues(location.entry, edit);
			}
		}

		for (const [storageKey, edit] of Object.entries(layout.edit ?? {})) {
			if (Object.prototype.hasOwnProperty.call(edit, 'parent')) {
				this.moveToParent(root, storageKey, edit.parent ?? null);
			}
		}
		for (const [storageKey, add] of Object.entries(layout.add ?? {})) {
			if (Object.prototype.hasOwnProperty.call(add, 'parent')) {
				this.moveToParent(root, storageKey, add.parent ?? null);
			}
		}

		for (const storageKey of layout.hide ?? []) {
			this.removeEntry(root, storageKey);
		}

		const placements = new Map<string, StoredMenuPlacement>();
		for (const [storageKey, edit] of Object.entries(layout.edit ?? {})) {
			if (this.hasPlacement(edit)) {
				placements.set(storageKey, edit);
			}
		}
		for (const [storageKey, add] of Object.entries(layout.add ?? {})) {
			if (this.hasPlacement(add)) {
				placements.set(storageKey, add);
			}
		}

		const placedSeparators = new Map<string, string[]>();
		for (const { entry } of this.walkEntries(root)) {
			if (this.isStructuralSeparator(entry) && placements.has(entry.storageKey)) {
				placedSeparators.set(entry.group, [...placedSeparators.get(entry.group) ?? [], entry.storageKey]);
			}
		}

		const applied = new Set<string>();
		const active = new Set<string>();
		const applyPlacement = (storageKey: string): void => {
			if (applied.has(storageKey) || active.has(storageKey)) {
				return;
			}
			const placement = placements.get(storageKey);
			if (!placement) {
				return;
			}

			active.add(storageKey);
			// Anchors are placed first, including a moved separator that starts the group this entry refers to.
			const anchor = placement.before ?? placement.after;
			if (anchor) {
				applyPlacement(anchor);
			}
			const group = placement.group ?? placement.beforeGroup ?? placement.afterGroup;
			for (const separatorKey of group ? placedSeparators.get(group) ?? [] : []) {
				applyPlacement(separatorKey);
			}
			this.moveByPlacement(root, storageKey, placement);
			active.delete(storageKey);
			applied.add(storageKey);
		};

		for (const storageKey of placements.keys()) {
			applyPlacement(storageKey);
		}

		// Separators stay exactly where they were placed. Only the rendered menu collapses
		// leading, trailing, and adjacent separators, so a later save never turns them into hide entries.
		return root;
	}

	protected createEditableAdd(storageKey: string, add: StoredMenuAdd): EditableMenuEntry {
		if (add.type === 'separator') {
			return {
				type: 'separator',
				key: `custom-separator:${storageKey}`,
				storageKey,
				custom: true
			};
		}

		if (add.type === 'submenu') {
			return {
				type: 'item',
				key: `custom-submenu:${storageKey}`,
				storageKey,
				label: add.label,
				when: add.when ?? undefined,
				icon: add.icon ?? undefined,
				custom: true,
				submenu: true,
				customSubmenu: true,
				children: [],
				defaultLabel: add.label
			};
		}

		const command = this.commandRegistry.getCommand(add.command);
		const defaultLabel = command?.label || add.command;
		const defaultIcon = command?.iconClass;
		return {
			type: 'item',
			key: `custom-command:${storageKey}`,
			storageKey,
			label: add.label ?? defaultLabel,
			commandId: add.command,
			when: add.when ?? undefined,
			icon: Object.prototype.hasOwnProperty.call(add, 'icon') ? add.icon ?? undefined : defaultIcon,
			custom: true,
			submenu: false,
			defaultLabel,
			defaultIcon
		};
	}

	protected applyEditValues(entry: EditableMenuItem, edit: StoredMenuEdit): void {
		if (edit.label !== undefined) {
			entry.label = edit.label;
			entry.labelOverride = edit.label;
		}
		if (Object.prototype.hasOwnProperty.call(edit, 'when')) {
			entry.when = edit.when ?? undefined;
			entry.whenOverride = edit.when ?? '';
		}
		if (Object.prototype.hasOwnProperty.call(edit, 'icon')) {
			entry.icon = edit.icon ?? undefined;
			entry.iconOverride = edit.icon ?? '';
		}
	}

	protected moveToParent(root: EditableMenuEntry[], storageKey: string, parentKey: string | null): void {
		const source = this.findLocation(root, storageKey);
		if (!source) {
			return;
		}

		let target = root;
		if (parentKey !== null) {
			const parentLocation = this.findLocation(root, parentKey);
			if (!parentLocation || parentLocation.entry.type !== 'item' || !parentLocation.entry.submenu) {
				return;
			}
			if (this.entryContainsStorageKey(source.entry, parentKey)) {
				return;
			}
			parentLocation.entry.children ??= [];
			target = parentLocation.entry.children;
		}

		if (source.parent === target) {
			return;
		}
		const [entry] = source.parent.splice(source.index, 1);
		target.push(entry);
	}

	protected moveByPlacement(root: EditableMenuEntry[], storageKey: string, placement: StoredMenuPlacement): void {
		let location = this.findLocation(root, storageKey);
		if (!location) {
			return;
		}

		if (placement.group) {
			this.moveToGroupPosition(root, storageKey, placement.group, placement.at ?? 'end');
			location = this.findLocation(root, storageKey);
			if (!location) {
				return;
			}
		}

		if (placement.beforeGroup) {
			this.moveBeforeGroup(root, storageKey, placement.beforeGroup);
			location = this.findLocation(root, storageKey);
			if (!location) {
				return;
			}
		} else if (placement.afterGroup) {
			this.moveAfterGroup(root, storageKey, placement.afterGroup);
			location = this.findLocation(root, storageKey);
			if (!location) {
				return;
			}
		} else if (!placement.group && placement.at) {
			this.moveToContainerEdge(root, storageKey, placement.at);
			location = this.findLocation(root, storageKey);
			if (!location) {
				return;
			}
		}

		if (placement.before) {
			this.moveRelative(root, storageKey, placement.before, 'before');
		} else if (placement.after) {
			this.moveRelative(root, storageKey, placement.after, 'after');
		}
	}

	protected moveToGroupPosition(
		root: EditableMenuEntry[],
		storageKey: string,
		group: string,
		position: 'start' | 'end'
	): void {
		const source = this.findLocation(root, storageKey);
		if (!source) {
			return;
		}
		const [entry] = source.parent.splice(source.index, 1);
		const range = this.findGroupRange(source.parent, group);
		if (!range) {
			source.parent.splice(Math.min(source.index, source.parent.length), 0, entry);
			return;
		}
		source.parent.splice(position === 'start' ? range.start : range.end, 0, entry);
	}

	protected moveBeforeGroup(root: EditableMenuEntry[], storageKey: string, group: string): void {
		const source = this.findLocation(root, storageKey);
		if (!source) {
			return;
		}
		const [entry] = source.parent.splice(source.index, 1);
		const range = this.findGroupRange(source.parent, group);
		if (!range) {
			source.parent.splice(Math.min(source.index, source.parent.length), 0, entry);
			return;
		}
		source.parent.splice(range.boundary, 0, entry);
	}

	protected moveAfterGroup(root: EditableMenuEntry[], storageKey: string, group: string): void {
		const source = this.findLocation(root, storageKey);
		if (!source) {
			return;
		}
		const [entry] = source.parent.splice(source.index, 1);
		const range = this.findGroupRange(source.parent, group);
		if (!range) {
			source.parent.splice(Math.min(source.index, source.parent.length), 0, entry);
			return;
		}
		source.parent.splice(range.end, 0, entry);
	}

	protected moveToContainerEdge(root: EditableMenuEntry[], storageKey: string, position: 'start' | 'end'): void {
		const source = this.findLocation(root, storageKey);
		if (!source) {
			return;
		}
		const [entry] = source.parent.splice(source.index, 1);
		source.parent.splice(position === 'start' ? 0 : source.parent.length, 0, entry);
	}

	protected moveRelative(
		root: EditableMenuEntry[],
		storageKey: string,
		anchorKey: string,
		position: 'before' | 'after'
	): void {
		const source = this.findLocation(root, storageKey);
		const anchor = this.findLocation(root, anchorKey);
		if (!source || !anchor || source.entry === anchor.entry || source.parent !== anchor.parent) {
			return;
		}

		const [entry] = source.parent.splice(source.index, 1);
		const refreshedAnchor = this.findLocation(root, anchorKey);
		if (!refreshedAnchor || refreshedAnchor.parent !== source.parent) {
			source.parent.splice(Math.min(source.index, source.parent.length), 0, entry);
			return;
		}
		const index = refreshedAnchor.index + (position === 'after' ? 1 : 0);
		refreshedAnchor.parent.splice(index, 0, entry);
	}

	protected findGroupRange(
		entries: EditableMenuEntry[],
		group: string
	): { boundary: number, start: number, end: number } | undefined {
		const separatorIndex = entries.findIndex(entry => this.isStructuralSeparator(entry) && entry.group === group);
		let boundary: number;
		let start: number;

		if (separatorIndex >= 0) {
			boundary = separatorIndex;
			start = separatorIndex + 1;
		} else {
			const memberIndex = entries.findIndex(entry => entry.type === 'item' && entry.defaultGroup === group);
			if (memberIndex < 0) {
				return undefined;
			}
			boundary = 0;
			start = 0;
		}

		let end = entries.length;
		for (let index = start; index < entries.length; index++) {
			if (this.isStructuralSeparator(entries[index])) {
				end = index;
				break;
			}
		}
		return {
			boundary,
			start,
			end
		};
	}

	protected hasPlacement(value: StoredMenuPlacement): boolean {
		return value.group !== undefined
			|| value.at !== undefined
			|| value.before !== undefined
			|| value.after !== undefined
			|| value.beforeGroup !== undefined
			|| value.afterGroup !== undefined;
	}

	protected resolveEditableEntries(
		entries: EditableMenuEntry[],
		defaultNodes: Map<string, MenuNode>
	): ResolvedMenuEntry[] {
		const resolved: ResolvedMenuEntry[] = [];

		for (const entry of entries) {
			if (entry.type === 'separator') {
				resolved.push({ type: 'separator' });
				continue;
			}

			let node: MenuNode | undefined;
			if (entry.custom) {
				if (entry.submenu) {
					const submenu = this.menuNodeFactory.createSubmenu(
						entry.storageKey,
						entry.label,
						undefined,
						undefined,
						entry.icon,
						entry.when
					);
					const children = this.resolveEditableEntries(entry.children ?? [], defaultNodes);
					submenu.children.push(...this.groupResolvedEntries(children, entry.storageKey));
					node = submenu;
				} else if (entry.commandId && this.commandRegistry.getCommand(entry.commandId)) {
					// A plain node instead of MenuNodeFactory.createCommandMenu: ActionMenuNode subscribes to
					// command handler and context key changes, and nodes built per render are never disposed.
					// Extension commands get the same argument conversion as extension contributed menu items.
					const commandId = entry.commandId;
					const when = entry.when;
					const adaptArgs = (effectiveMenuPath: MenuPath, args: unknown[]): unknown[] =>
						this.pluginContributionHandler.hasCommand(commandId)
							? this.pluginMenuCommandAdapter.getArgumentAdapter(effectiveMenuPath)(...args)
							: args;
					const commandMenu: CommandMenu & AcceleratorSource = {
						id: commandId,
						label: entry.label,
						icon: entry.icon,
						when,
						sortString: '',
						isVisible: (effectiveMenuPath, contextMatcher, context, ...args) =>
							(!when || contextMatcher.match(when, context))
							&& this.commandRegistry.isVisible(commandId, ...adaptArgs(effectiveMenuPath, args)),
						isEnabled: (effectiveMenuPath, ...args) => this.commandRegistry.isEnabled(commandId, ...adaptArgs(effectiveMenuPath, args)),
						isToggled: (effectiveMenuPath, ...args) => this.commandRegistry.isToggled(commandId, ...adaptArgs(effectiveMenuPath, args)),
						run: async (effectiveMenuPath, ...args) => {
							await this.commandRegistry.executeCommand(commandId, ...adaptArgs(effectiveMenuPath, args));
						},
						getAccelerator: context => {
							const binding = this.keybindingRegistry.getKeybindingsForCommand(commandId)
								.find(candidate => this.keybindingRegistry.isEnabledInScope(candidate, context));
							return binding ? this.keybindingRegistry.acceleratorFor(binding, '+', environment.electron.is()) : [];
						}
					};
					node = commandMenu;
				}
			} else {
				node = defaultNodes.get(entry.storageKey);
				if (node && entry.submenu && CompoundMenuNode.is(node)) {
					const children = this.resolveEditableEntries(entry.children ?? [], defaultNodes);
					node = this.cloneCompoundWithResolvedEntries(node, children, entry.storageKey);
				}
				if (node) {
					node = this.applyEditableOverridesToNode(node, entry);
				}
			}

			if (node) {
				resolved.push({
					type: 'item',
					node
				});
			}
		}

		return this.sanitizeResolvedSeparators(resolved);
	}

	protected applyEditableOverridesToNode(node: MenuNode, entry: EditableMenuItem): MenuNode {
		const labelChanged = RenderedMenuNode.is(node) && entry.label !== (entry.defaultLabel ?? entry.label);
		const whenChanged = (entry.when ?? '') !== (entry.defaultWhen ?? '');
		const iconChanged = RenderedMenuNode.is(node) && (entry.icon ?? '') !== (entry.defaultIcon ?? '');

		if (!labelChanged && !whenChanged && !iconChanged) {
			return node;
		}

		const customized = Object.create(node) as MenuNode;
		if (labelChanged) {
			Object.defineProperty(customized, 'label', {
				value: entry.label,
				configurable: true,
				enumerable: true
			});
		}
		if (iconChanged) {
			Object.defineProperty(customized, 'icon', {
				value: entry.icon,
				configurable: true,
				enumerable: true
			});
		}
		if (whenChanged) {
			const overrideWhen = entry.when ?? '';
			const originalWhen = entry.defaultWhen;
			Object.defineProperty(customized, 'when', {
				value: entry.when,
				configurable: true,
				enumerable: true
			});
			Object.defineProperty(customized, 'isVisible', {
				value: <T>(
					effectiveMenuPath: MenuPath,
					contextMatcher: ContextExpressionMatcher<T>,
					context: T | undefined,
					...args: unknown[]
				): boolean => {
					if (overrideWhen && !contextMatcher.match(overrideWhen, context)) {
						return false;
					}

					if (CompoundMenuNode.is(node) && !CommandMenu.is(node)) {
						return true;
					}

					if (!originalWhen) {
						return node.isVisible(effectiveMenuPath, contextMatcher, context, ...args);
					}

					const matcher: ContextExpressionMatcher<T> = {
						match: (expression, matchContext) => expression === originalWhen
							? true
							: contextMatcher.match(expression, matchContext)
					};
					return node.isVisible(effectiveMenuPath, matcher, context, ...args);
				},
				configurable: true
			});
		}
		return customized;
	}

	protected cloneCompoundWithResolvedEntries(
		menu: CompoundMenuNode,
		entries: ResolvedMenuEntry[],
		key: string
	): CompoundMenuNode {
		const customized = Object.create(menu) as CompoundMenuNode;
		const children = this.groupResolvedEntries(entries, key);
		Object.defineProperty(customized, 'children', {
			value: children,
			writable: true,
			configurable: true,
			enumerable: true
		});
		Object.defineProperty(customized, 'isEmpty', {
			value: <T>(
				effectiveMenuPath: MenuPath,
				contextMatcher: ContextExpressionMatcher<T>,
				context: T | undefined,
				...args: unknown[]
			): boolean => {
				for (const child of children) {
					if (child.isVisible(effectiveMenuPath, contextMatcher, context, ...args)) {
						if (!CompoundMenuNode.is(child) || !child.isEmpty(effectiveMenuPath, contextMatcher, context, ...args)) {
							return false;
						}
					}
				}
				return true;
			},
			configurable: true
		});
		return customized;
	}

	protected groupResolvedEntries(entries: ResolvedMenuEntry[], key: string): MenuNode[] {
		const groups: GroupImpl[] = [];
		let current: MenuNode[] = [];

		const flush = (): void => {
			if (!current.length) {
				return;
			}
			const group = new GroupImpl(
				`custom-context-menu-${this.safeId(key)}-${groups.length}`,
				groups.length.toString().padStart(4, '0')
			);
			group.children.push(...current);
			groups.push(group);
			current = [];
		};

		for (const entry of entries) {
			if (entry.type === 'separator') {
				flush();
			} else {
				current.push(entry.node);
			}
		}
		flush();
		return groups;
	}

	/**
	 * Storage keys are the Theia menu path relative to the target menu, for example `navigation/some.command`
	 * or `separator:1_cut` for the separator before a group. They only depend on where an extension
	 * contributed the node, so other occurrences of the same command elsewhere never change them.
	 */
	protected flattenChildren(
		children: MenuNode[],
		parentPath: MenuPath,
		relativePath: string[],
		inheritedGroup?: string
	): DefaultMenuEntry[] {
		const result: DefaultMenuEntry[] = [];
		const keyOccurrences = new Map<string, number>();

		for (const child of children) {
			const childPath = [...parentPath, child.id];
			const childRelativePath = [...relativePath, child.id];
			if (Group.is(child)) {
				// Theia's menu renderer never shows inline groups in context menus.
				if (child.id === 'inline') {
					continue;
				}
				const groupEntries = this.flattenChildren(child.children, childPath, childRelativePath, child.id);
				if (!groupEntries.length) {
					continue;
				}
				if (result.length && result[result.length - 1].type !== 'separator') {
					const key = `default-separator:${this.pathKey(childPath)}`;
					result.push({
						type: 'separator',
						key,
						storageKey: `separator:${this.storagePath(childRelativePath)}`,
						custom: false,
						group: child.id
					});
				}
				result.push(...groupEntries);
				continue;
			}

			const baseKey = `node:${this.pathKey(childPath)}`;
			const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
			keyOccurrences.set(baseKey, occurrence);
			const key = occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`;
			const storageKey = occurrence === 1
				? this.storagePath(childRelativePath)
				: `${this.storagePath(childRelativePath)}#${occurrence}`;

			if (CommandMenu.is(child)) {
				result.push({
					type: 'item',
					key,
					storageKey,
					label: child.label,
					commandId: child.id,
					when: child.when,
					icon: child.icon,
					custom: false,
					submenu: false,
					defaultLabel: child.label,
					defaultWhen: child.when,
					defaultIcon: child.icon,
					defaultGroup: inheritedGroup,
					node: child,
					nodeId: child.id
				});
				continue;
			}

			if (CompoundMenuNode.is(child) && RenderedMenuNode.is(child)) {
				result.push({
					type: 'item',
					key,
					storageKey,
					label: child.label,
					when: child.when,
					icon: child.icon,
					custom: false,
					submenu: true,
					children: this.flattenChildren(child.children, childPath, childRelativePath),
					defaultLabel: child.label,
					defaultWhen: child.when,
					defaultIcon: child.icon,
					defaultGroup: inheritedGroup,
					node: child,
					nodeId: child.id
				});
			}
		}

		return this.sanitizeDefaultSeparators(result);
	}

	protected toEditableEntries(entries: DefaultMenuEntry[]): EditableMenuEntry[] {
		return entries.map(entry => {
			if (entry.type === 'separator') {
				return {
					type: 'separator',
					key: entry.key,
					storageKey: entry.storageKey,
					custom: false,
					group: entry.group
				};
			}

			return {
				type: 'item',
				key: entry.key,
				storageKey: entry.storageKey,
				label: entry.label,
				commandId: entry.commandId,
				when: entry.when,
				icon: entry.icon,
				custom: false,
				submenu: entry.submenu,
				children: entry.children ? this.toEditableEntries(entry.children as DefaultMenuEntry[]) : undefined,
				defaultLabel: entry.label,
				defaultWhen: entry.when,
				defaultIcon: entry.icon,
				defaultGroup: entry.defaultGroup
			};
		});
	}

	protected collectDefaultNodes(entries: DefaultMenuEntry[], target = new Map<string, MenuNode>()): Map<string, MenuNode> {
		for (const entry of entries) {
			if (entry.type === 'item') {
				target.set(entry.storageKey, entry.node);
				if (entry.children) {
					this.collectDefaultNodes(entry.children as DefaultMenuEntry[], target);
				}
			}
		}
		return target;
	}

	protected collectLocations(entries: EditableMenuEntry[]): Map<string, EntryLocation> {
		const locations = new Map<string, EntryLocation>();
		const visit = (children: EditableMenuEntry[], parentKey: string | null): void => {
			for (let index = 0; index < children.length; index++) {
				const entry = children[index];
				locations.set(entry.storageKey, {
					entry,
					parent: children,
					parentKey,
					index
				});
				if (entry.type === 'item' && entry.children) {
					visit(entry.children, entry.storageKey);
				}
			}
		};
		visit(entries, null);
		return locations;
	}

	protected *walkEntries(
		entries: EditableMenuEntry[],
		parentKey: string | null = null
	): IterableIterator<{ entry: EditableMenuEntry, parentKey: string | null }> {
		for (const entry of entries) {
			yield {
				entry,
				parentKey
			};
			if (entry.type === 'item' && entry.children) {
				yield* this.walkEntries(entry.children, entry.storageKey);
			}
		}
	}

	protected collectFirstGroups(
		entries: EditableMenuEntry[],
		parentKey: string | null = null,
		target = new Map<string | null, string>()
	): Map<string | null, string> {
		for (const entry of entries) {
			if (this.isStructuralSeparator(entry)) {
				break;
			}
			if (entry.type === 'item' && entry.defaultGroup) {
				target.set(parentKey, entry.defaultGroup);
				break;
			}
		}
		for (const entry of entries) {
			if (entry.type === 'item' && entry.children) {
				this.collectFirstGroups(entry.children, entry.storageKey, target);
			}
		}
		return target;
	}

	protected collectContainers(
		entries: EditableMenuEntry[],
		parentKey: string | null = null,
		target = new Map<string | null, EditableMenuEntry[]>()
	): Map<string | null, EditableMenuEntry[]> {
		target.set(parentKey, entries);
		for (const entry of entries) {
			if (entry.type === 'item' && entry.children) {
				this.collectContainers(entry.children, entry.storageKey, target);
			}
		}
		return target;
	}

	protected findLocation(entries: EditableMenuEntry[], storageKey: string): EntryLocation | undefined {
		const visit = (children: EditableMenuEntry[], parentKey: string | null): EntryLocation | undefined => {
			for (let index = 0; index < children.length; index++) {
				const entry = children[index];
				if (entry.storageKey === storageKey) {
					return {
						entry,
						parent: children,
						parentKey,
						index
					};
				}
				if (entry.type === 'item' && entry.children) {
					const child = visit(entry.children, entry.storageKey);
					if (child) {
						return child;
					}
				}
			}
			return undefined;
		};
		return visit(entries, null);
	}

	protected removeEntry(entries: EditableMenuEntry[], storageKey: string): boolean {
		const location = this.findLocation(entries, storageKey);
		if (!location) {
			return false;
		}
		location.parent.splice(location.index, 1);
		return true;
	}

	protected entryContainsStorageKey(entry: EditableMenuEntry, storageKey: string): boolean {
		if (entry.storageKey === storageKey) {
			return true;
		}
		return entry.type === 'item'
			&& !!entry.children?.some(child => this.entryContainsStorageKey(child, storageKey));
	}

	protected cloneEntries(entries: EditableMenuEntry[]): EditableMenuEntry[] {
		return entries.map(entry => {
			if (entry.type === 'separator') {
				return {
					...entry
				};
			}
			return {
				...entry,
				children: entry.children ? this.cloneEntries(entry.children) : undefined
			};
		});
	}

	protected sanitizeDefaultSeparators(entries: DefaultMenuEntry[]): DefaultMenuEntry[] {
		return this.sanitizeSeparators(entries);
	}

	protected sanitizeResolvedSeparators(entries: ResolvedMenuEntry[]): ResolvedMenuEntry[] {
		return this.sanitizeSeparators(entries);
	}

	protected sanitizeSeparators<T extends { type: 'item' | 'separator' }>(entries: T[]): T[] {
		const result: T[] = [];
		for (const entry of entries) {
			if (entry.type === 'separator' && (!result.length || result[result.length - 1].type === 'separator')) {
				continue;
			}
			result.push(entry);
		}
		while (result[result.length - 1]?.type === 'separator') {
			result.pop();
		}
		return result;
	}

	protected isStructuralSeparator(entry: EditableMenuEntry | undefined): entry is EditableMenuSeparator & { group: string } {
		return !!entry && entry.type === 'separator' && !entry.custom && typeof entry.group === 'string';
	}

	protected longestCommonSubsequence(left: string[], right: string[]): string[] {
		const rows = left.length + 1;
		const columns = right.length + 1;
		const lengths = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

		for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex--) {
			for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex--) {
				lengths[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
					? lengths[leftIndex + 1][rightIndex + 1] + 1
					: Math.max(lengths[leftIndex + 1][rightIndex], lengths[leftIndex][rightIndex + 1]);
			}
		}

		const sequence: string[] = [];
		let leftIndex = 0;
		let rightIndex = 0;
		while (leftIndex < left.length && rightIndex < right.length) {
			if (left[leftIndex] === right[rightIndex]) {
				sequence.push(left[leftIndex]);
				leftIndex++;
				rightIndex++;
			} else if (lengths[leftIndex + 1][rightIndex] > lengths[leftIndex][rightIndex + 1]) {
				leftIndex++;
			} else {
				rightIndex++;
			}
		}
		return sequence;
	}

	protected arraysEqual(left: string[], right: string[]): boolean {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}

	protected storagePath(path: MenuPath): string {
		return path.map(segment => segment.replace(/[%/#]/g, character => encodeURIComponent(character))).join('/');
	}

	protected pathKey(path: MenuPath): string {
		return path.map(segment => encodeURIComponent(segment)).join('/');
	}

	protected safeId(value: string): string {
		return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
	}

	protected pathsEqual(left: MenuPath, right: MenuPath): boolean {
		return left.length === right.length && left.every((segment, index) => segment === right[index]);
	}
}
