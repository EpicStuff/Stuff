import {
	CommandMenu,
	CommandRegistry,
	CompoundMenuNode,
	ContextExpressionMatcher,
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
import { inject, injectable } from '@theia/core/shared/inversify';
import {
	CONTEXT_MENU_TARGETS,
	CUSTOM_CONTEXT_MENU_LAYOUTS,
	ContextMenuConfigurationChanges,
	ContextMenuTarget,
	EditableMenuEntry,
	EditableMenuItem,
	EditableMenuSeparator,
	StoredMenuAdd,
	StoredMenuEdit,
	StoredMenuLayout,
	StoredMenuLayouts,
	StoredMenuPlacement
} from './custom-context-menu-types';

interface DefaultMenuItem extends EditableMenuItem {
	custom: false;
	node: MenuNode;
	nodeId: string;
	sourceIdentity: string;
}

interface DefaultMenuSeparator extends EditableMenuSeparator {
	custom: false;
	group: string;
	sourceIdentity: string;
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

			const customizedMenu = service.customize(options.menuPath, sourceMenu);
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

	getDraftEntries(targetId: string): EditableMenuEntry[] {
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

	async applyChanges(changes: ContextMenuConfigurationChanges): Promise<void> {
		const layouts: StoredMenuLayouts = {
			...this.readLayouts()
		};

		for (const targetId of changes.resets) {
			delete layouts[targetId];
		}

		for (const [targetId, entries] of Object.entries(changes.layouts)) {
			const snapshot = this.getDefaultSnapshot(targetId);
			if (!snapshot) {
				continue;
			}

			const defaults = this.toEditableEntries(snapshot);
			const layout = this.createSparseLayout(defaults, this.cloneEntries(entries));
			if (this.isLayoutEmpty(layout)) {
				delete layouts[targetId];
			} else {
				layouts[targetId] = layout;
			}
		}

		await this.preferenceService.set(CUSTOM_CONTEXT_MENU_LAYOUTS, layouts, PreferenceScope.User);
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
		const entries = this.flattenChildren(menu.children, menuPath);
		this.assignStorageKeys(entries);
		return this.sanitizeDefaultSeparators(entries);
	}

	protected readLayouts(): StoredMenuLayouts {
		const value = this.preferenceService.get<unknown>(CUSTOM_CONTEXT_MENU_LAYOUTS, {});
		if (!this.isRecord(value)) {
			return {};
		}

		const layouts: StoredMenuLayouts = {};
		for (const [targetId, candidate] of Object.entries(value)) {
			if (this.isSparseLayout(candidate)) {
				layouts[targetId] = candidate;
			}
		}
		return layouts;
	}

	protected getStoredLayout(targetId: string): StoredMenuLayout | undefined {
		return this.readLayouts()[targetId];
	}

	protected isSparseLayout(value: unknown): value is StoredMenuLayout {
		if (!this.isRecord(value) || 'entries' in value || 'knownDefaultKeys' in value) {
			return false;
		}
		if (value.hide !== undefined && (!Array.isArray(value.hide) || !value.hide.every(item => typeof item === 'string'))) {
			return false;
		}
		if (value.edit !== undefined && !this.isRecord(value.edit)) {
			return false;
		}
		if (value.add !== undefined && !this.isRecord(value.add)) {
			return false;
		}
		return true;
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
		firstGroups: Map<string | null, string>
	): void {
		const baselineContainers = this.collectContainers(baseline);
		const desiredContainers = this.collectContainers(desired);

		for (const [parentKey, desiredEntries] of desiredContainers) {
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

				const placement = this.derivePlacement(desiredEntries, index, stable, placed, firstGroups.get(parentKey));
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
		firstGroup?: string
	): StoredMenuPlacement {
		const entry = entries[index];
		const targetGroup = this.groupAt(entries, index, firstGroup);
		const defaultGroup = entry.type === 'item' ? entry.defaultGroup : undefined;
		const immediateNext = entries[index + 1];
		const immediatePrevious = entries[index - 1];

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

		const next = this.findPlacementAnchor(entries, index, 1, stable, placed);
		const previous = this.findPlacementAnchor(entries, index, -1, stable, placed);
		const placement: StoredMenuPlacement = {};

		if (targetGroup && targetGroup !== defaultGroup && entry.type === 'item') {
			placement.group = targetGroup;
		}

		if (next) {
			if (this.isStructuralSeparator(next)) {
				delete placement.group;
				placement.beforeGroup = next.group;
			} else {
				placement.before = next.storageKey;
			}
			return placement;
		}

		if (previous) {
			if (this.isStructuralSeparator(previous)) {
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
			const anchor = placement.before ?? placement.after;
			if (anchor && placements.has(anchor)) {
				applyPlacement(anchor);
			}
			this.moveByPlacement(root, storageKey, placement);
			active.delete(storageKey);
			applied.add(storageKey);
		};

		for (const storageKey of placements.keys()) {
			applyPlacement(storageKey);
		}

		return this.sanitizeEditableTree(root);
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
					node = this.menuNodeFactory.createCommandMenu({
						commandId: entry.commandId,
						label: entry.label,
						icon: entry.icon,
						when: entry.when
					});
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

	protected flattenChildren(
		children: MenuNode[],
		parentPath: MenuPath,
		inheritedGroup?: string
	): DefaultMenuEntry[] {
		const result: DefaultMenuEntry[] = [];
		const keyOccurrences = new Map<string, number>();

		for (const child of children) {
			const childPath = [...parentPath, child.id];
			if (Group.is(child)) {
				const groupEntries = this.flattenChildren(child.children, childPath, child.id);
				if (!groupEntries.length) {
					continue;
				}
				if (result.length && result[result.length - 1].type !== 'separator') {
					const key = `default-separator:${this.pathKey(childPath)}`;
					result.push({
						type: 'separator',
						key,
						storageKey: key,
						custom: false,
						group: child.id,
						sourceIdentity: key
					});
				}
				result.push(...groupEntries);
				continue;
			}

			const baseKey = `node:${this.pathKey(childPath)}`;
			const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
			keyOccurrences.set(baseKey, occurrence);
			const key = occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`;

			if (CommandMenu.is(child)) {
				result.push({
					type: 'item',
					key,
					storageKey: key,
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
					nodeId: child.id,
					sourceIdentity: `${key}|${child.when ?? ''}`
				});
				continue;
			}

			if (CompoundMenuNode.is(child) && RenderedMenuNode.is(child)) {
				result.push({
					type: 'item',
					key,
					storageKey: key,
					label: child.label,
					when: child.when,
					icon: child.icon,
					custom: false,
					submenu: true,
					children: this.flattenChildren(child.children, childPath),
					defaultLabel: child.label,
					defaultWhen: child.when,
					defaultIcon: child.icon,
					defaultGroup: inheritedGroup,
					node: child,
					nodeId: child.id,
					sourceIdentity: `${key}|${child.when ?? ''}`
				});
			}
		}

		return this.sanitizeDefaultSeparators(result);
	}

	protected assignStorageKeys(entries: DefaultMenuEntry[]): void {
		const all = this.walkDefaultEntries(entries);
		const groups = new Map<string, DefaultMenuEntry[]>();

		for (const entry of all) {
			const base = entry.type === 'separator'
				? `separator:${entry.group}`
				: entry.commandId ?? `submenu:${entry.nodeId}`;
			const bucket = groups.get(base) ?? [];
			bucket.push(entry);
			groups.set(base, bucket);
		}

		for (const [base, bucket] of groups) {
			if (bucket.length === 1) {
				bucket[0].storageKey = base;
				continue;
			}

			const used = new Set<string>();
			for (const entry of bucket) {
				let key = `${base}@${this.hash(entry.sourceIdentity)}`;
				let suffix = 2;
				while (used.has(key)) {
					key = `${base}@${this.hash(entry.sourceIdentity)}-${suffix++}`;
				}
				used.add(key);
				entry.storageKey = key;
			}
		}
	}

	protected walkDefaultEntries(entries: DefaultMenuEntry[]): DefaultMenuEntry[] {
		const result: DefaultMenuEntry[] = [];
		for (const entry of entries) {
			result.push(entry);
			if (entry.type === 'item' && entry.children) {
				result.push(...this.walkDefaultEntries(entry.children as DefaultMenuEntry[]));
			}
		}
		return result;
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

	protected sanitizeEditableTree(entries: EditableMenuEntry[]): EditableMenuEntry[] {
		const sanitized = this.sanitizeSeparators(entries);
		for (const entry of sanitized) {
			if (entry.type === 'item' && entry.children) {
				entry.children = this.sanitizeEditableTree(entry.children);
			}
		}
		return sanitized;
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

	protected hash(value: string): string {
		let hash = 0x811c9dc5;
		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193);
		}
		return (hash >>> 0).toString(36);
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
