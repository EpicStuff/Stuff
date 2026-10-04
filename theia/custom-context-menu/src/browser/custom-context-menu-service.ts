import {
	CommandMenu,
	CommandRegistry,
	CompoundMenuNode,
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
	StoredMenuEntry,
	StoredMenuItem,
	StoredMenuLayout,
	StoredMenuLayouts
} from './custom-context-menu-types';

interface DefaultMenuItem {
	type: 'item';
	key: string;
	label: string;
	commandId?: string;
	when?: string;
	icon?: string;
	custom: false;
	submenu: boolean;
	children?: DefaultMenuEntry[];
	node: MenuNode;
}

interface DefaultMenuSeparator {
	type: 'separator';
	key: string;
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
		const target = this.getTarget(targetId);
		const menu = target && this.menuRegistry.getMenu(target.path);
		if (!target || !menu) {
			return [];
		}
		return this.flattenMenu(menu, target.path).map(entry => this.toEditable(entry));
	}

	getDraftEntries(targetId: string): EditableMenuEntry[] {
		const target = this.getTarget(targetId);
		const menu = target && this.menuRegistry.getMenu(target.path);
		if (!target || !menu) {
			return [];
		}

		const defaults = this.flattenMenu(menu, target.path);
		const layout = this.getStoredLayout(targetId);
		if (!layout) {
			return defaults.map(entry => this.toEditable(entry));
		}

		const defaultIndex = this.indexDefaults(defaults);
		return this.resolveEditableEntries(layout.entries, layout.knownDefaultKeys, defaults, defaultIndex);
	}

	async applyChanges(changes: ContextMenuConfigurationChanges): Promise<void> {
		const layouts: StoredMenuLayouts = {
			...this.readLayouts()
		};

		for (const targetId of changes.resets) {
			delete layouts[targetId];
		}

		for (const [targetId, entries] of Object.entries(changes.layouts)) {
			const target = this.getTarget(targetId);
			const menu = target && this.menuRegistry.getMenu(target.path);
			if (!target || !menu) {
				continue;
			}

			const defaults = this.flattenMenu(menu, target.path);
			const defaultIndex = this.indexDefaults(defaults);
			layouts[targetId] = {
				entries: this.toStoredEntries(entries, defaults, defaultIndex),
				knownDefaultKeys: defaults.map(entry => entry.key)
			};
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

		const defaults = this.flattenMenu(menu, target.path);
		const defaultIndex = this.indexDefaults(defaults);
		const resolved = this.resolveRenderedEntries(layout.entries, layout.knownDefaultKeys, defaults, defaultIndex);
		return this.cloneCompoundWithEntries(menu, resolved, `root-${target.id}`);
	}

	protected readLayouts(): StoredMenuLayouts {
		const value = this.preferenceService.get<StoredMenuLayouts>(CUSTOM_CONTEXT_MENU_LAYOUTS, {});
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	}

	protected getStoredLayout(targetId: string): StoredMenuLayout | undefined {
		const layout = this.readLayouts()[targetId];
		if (!layout || !Array.isArray(layout.entries) || !Array.isArray(layout.knownDefaultKeys)) {
			return undefined;
		}
		return layout;
	}

	protected resolveEditableEntries(
		storedEntries: StoredMenuEntry[],
		knownDefaultKeys: string[],
		defaults: DefaultMenuEntry[],
		defaultIndex: Map<string, DefaultMenuEntry>
	): EditableMenuEntry[] {
		const result: EditableMenuEntry[] = [];
		const used = new Set<string>();

		for (const stored of storedEntries) {
			if (stored.type === 'separator') {
				result.push({
					type: 'separator',
					key: stored.key
				});
				continue;
			}

			const defaultEntry = defaultIndex.get(stored.key);
			if (defaultEntry?.type === 'item') {
				const editable = this.toEditable(defaultEntry) as EditableMenuItem;
				if (editable.submenu && Array.isArray(stored.entries)) {
					const defaultChildren = defaultEntry.children ?? [];
					editable.children = this.resolveEditableEntries(
						stored.entries,
						stored.knownDefaultKeys ?? defaultChildren.map(entry => entry.key),
						defaultChildren,
						defaultIndex
					);
				}
				result.push(editable);
				used.add(stored.key);
				continue;
			}

			if (stored.customSubmenu) {
				result.push({
					type: 'item',
					key: stored.key,
					label: stored.label || 'Submenu',
					custom: true,
					submenu: true,
					customSubmenu: true,
					children: this.resolveEditableEntries(
						stored.entries ?? [],
						stored.knownDefaultKeys ?? [],
						[],
						defaultIndex
					)
				});
				continue;
			}

			if (stored.commandId) {
				const command = this.commandRegistry.getCommand(stored.commandId);
				result.push({
					type: 'item',
					key: stored.key,
					label: command?.label || stored.commandId,
					commandId: stored.commandId,
					icon: command?.iconClass,
					custom: true,
					submenu: false
				});
			}
		}

		const knownDefaults = new Set(knownDefaultKeys);
		for (const entry of defaults) {
			if (!knownDefaults.has(entry.key) && !used.has(entry.key)) {
				result.push(this.toEditable(entry));
			}
		}

		return this.sanitizeEditableTree(result);
	}

	protected resolveRenderedEntries(
		storedEntries: StoredMenuEntry[],
		knownDefaultKeys: string[],
		defaults: DefaultMenuEntry[],
		defaultIndex: Map<string, DefaultMenuEntry>
	): ResolvedMenuEntry[] {
		const result: ResolvedMenuEntry[] = [];
		const used = new Set<string>();

		for (const stored of storedEntries) {
			if (stored.type === 'separator') {
				result.push({ type: 'separator' });
				continue;
			}

			const defaultEntry = defaultIndex.get(stored.key);
			if (defaultEntry?.type === 'item') {
				let node = defaultEntry.node;
				if (defaultEntry.submenu && CompoundMenuNode.is(node) && Array.isArray(stored.entries)) {
					const defaultChildren = defaultEntry.children ?? [];
					const children = this.resolveRenderedEntries(
						stored.entries,
						stored.knownDefaultKeys ?? defaultChildren.map(entry => entry.key),
						defaultChildren,
						defaultIndex
					);
					node = this.cloneCompoundWithEntries(node, children, stored.key);
				}
				result.push({
					type: 'item',
					node
				});
				used.add(stored.key);
				continue;
			}

			if (stored.customSubmenu) {
				const submenu = this.menuNodeFactory.createSubmenu(
					stored.key,
					stored.label || 'Submenu',
					undefined
				);
				const children = this.resolveRenderedEntries(
					stored.entries ?? [],
					stored.knownDefaultKeys ?? [],
					[],
					defaultIndex
				);
				const groupedChildren = this.groupResolvedEntries(children, stored.key);
				submenu.children.push(...groupedChildren);
				result.push({
					type: 'item',
					node: submenu
				});
				continue;
			}

			if (stored.commandId && this.commandRegistry.getCommand(stored.commandId)) {
				result.push({
					type: 'item',
					node: this.menuNodeFactory.createCommandMenu({
						commandId: stored.commandId
					})
				});
			}
		}

		const knownDefaults = new Set(knownDefaultKeys);
		for (const entry of defaults) {
			if (knownDefaults.has(entry.key) || used.has(entry.key)) {
				continue;
			}
			if (entry.type === 'separator') {
				result.push({ type: 'separator' });
			} else {
				result.push({
					type: 'item',
					node: entry.node
				});
			}
		}

		return this.sanitizeResolvedSeparators(result);
	}

	protected cloneCompoundWithEntries(menu: CompoundMenuNode, entries: ResolvedMenuEntry[], key: string): CompoundMenuNode {
		const customized = Object.create(menu) as CompoundMenuNode;
		Object.defineProperty(customized, 'children', {
			value: this.groupResolvedEntries(entries, key),
			writable: true,
			configurable: true,
			enumerable: true
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

	protected flattenMenu(menu: CompoundMenuNode, menuPath: MenuPath): DefaultMenuEntry[] {
		return this.sanitizeDefaultSeparators(this.flattenChildren(menu.children, menuPath));
	}

	protected flattenChildren(children: MenuNode[], parentPath: MenuPath): DefaultMenuEntry[] {
		const result: DefaultMenuEntry[] = [];

		for (const child of children) {
			const childPath = [...parentPath, child.id];
			if (Group.is(child)) {
				const groupEntries = this.flattenChildren(child.children, childPath);
				if (!groupEntries.length) {
					continue;
				}
				if (result.length && result[result.length - 1].type !== 'separator') {
					result.push({
						type: 'separator',
						key: `default-separator:${this.pathKey(childPath)}`
					});
				}
				result.push(...groupEntries);
				continue;
			}

			if (CommandMenu.is(child)) {
				result.push({
					type: 'item',
					key: `node:${this.pathKey(childPath)}`,
					label: child.label,
					commandId: child.id,
					when: child.when,
					icon: child.icon,
					custom: false,
					submenu: false,
					node: child
				});
				continue;
			}

			if (CompoundMenuNode.is(child) && RenderedMenuNode.is(child)) {
				result.push({
					type: 'item',
					key: `node:${this.pathKey(childPath)}`,
					label: child.label,
					when: child.when,
					icon: child.icon,
					custom: false,
					submenu: true,
					children: this.flattenChildren(child.children, childPath),
					node: child
				});
			}
		}

		return this.sanitizeDefaultSeparators(result);
	}

	protected indexDefaults(entries: DefaultMenuEntry[], target = new Map<string, DefaultMenuEntry>()): Map<string, DefaultMenuEntry> {
		for (const entry of entries) {
			target.set(entry.key, entry);
			if (entry.type === 'item' && entry.children) {
				this.indexDefaults(entry.children, target);
			}
		}
		return target;
	}

	protected toEditable(entry: DefaultMenuEntry): EditableMenuEntry {
		if (entry.type === 'separator') {
			return {
				type: 'separator',
				key: entry.key
			};
		}
		return {
			type: 'item',
			key: entry.key,
			label: entry.label,
			commandId: entry.commandId,
			when: entry.when,
			icon: entry.icon,
			custom: false,
			submenu: entry.submenu,
			children: entry.children?.map(child => this.toEditable(child))
		};
	}

	protected toStoredEntries(
		entries: EditableMenuEntry[],
		defaults: DefaultMenuEntry[],
		defaultIndex: Map<string, DefaultMenuEntry>
	): StoredMenuEntry[] {
		return entries.map(entry => {
			if (entry.type === 'separator') {
				return {
					type: 'separator',
					key: entry.key
				};
			}

			const stored: StoredMenuItem = {
				type: 'item',
				key: entry.key
			};

			if (entry.customSubmenu) {
				stored.customSubmenu = true;
				stored.label = entry.label;
			} else if (entry.custom && entry.commandId) {
				stored.commandId = entry.commandId;
			}

			if (entry.submenu) {
				const defaultEntry = defaultIndex.get(entry.key);
				const defaultChildren = defaultEntry?.type === 'item' ? defaultEntry.children ?? [] : [];
				stored.entries = this.toStoredEntries(entry.children ?? [], defaultChildren, defaultIndex);
				stored.knownDefaultKeys = defaultChildren.map(child => child.key);
			}

			return stored;
		});
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
