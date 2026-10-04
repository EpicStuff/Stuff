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
	StoredMenuLayout,
	StoredMenuLayouts
} from './custom-context-menu-types';

interface DefaultMenuItem extends EditableMenuItem {
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

		return this.resolveEditableLayout(layout, defaults);
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
			layouts[targetId] = {
				entries: entries.map(entry => this.toStored(entry)),
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
		const resolved = this.resolveRenderedLayout(layout, defaults);
		return this.createMenuRoot(menu, target, resolved);
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

	protected resolveEditableLayout(layout: StoredMenuLayout, defaults: DefaultMenuEntry[]): EditableMenuEntry[] {
		const defaultMap = new Map(defaults.map(entry => [entry.key, entry]));
		const result: EditableMenuEntry[] = [];
		const used = new Set<string>();

		for (const stored of layout.entries) {
			if (stored.type === 'separator') {
				result.push({
					type: 'separator',
					key: stored.key
				});
				continue;
			}

			const defaultEntry = defaultMap.get(stored.key);
			if (defaultEntry?.type === 'item') {
				result.push(this.toEditable(defaultEntry));
				used.add(stored.key);
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

		const knownDefaults = new Set(layout.knownDefaultKeys);
		for (const entry of defaults) {
			if (!knownDefaults.has(entry.key) && !used.has(entry.key)) {
				result.push(this.toEditable(entry));
			}
		}

		return this.sanitizeEditableSeparators(result);
	}

	protected resolveRenderedLayout(layout: StoredMenuLayout, defaults: DefaultMenuEntry[]): ResolvedMenuEntry[] {
		const defaultMap = new Map(defaults.map(entry => [entry.key, entry]));
		const result: ResolvedMenuEntry[] = [];
		const used = new Set<string>();

		for (const stored of layout.entries) {
			if (stored.type === 'separator') {
				result.push({ type: 'separator' });
				continue;
			}

			const defaultEntry = defaultMap.get(stored.key);
			if (defaultEntry?.type === 'item') {
				result.push({
					type: 'item',
					node: defaultEntry.node
				});
				used.add(stored.key);
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

		const knownDefaults = new Set(layout.knownDefaultKeys);
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

	protected createMenuRoot(menu: CompoundMenuNode, target: ContextMenuTarget, entries: ResolvedMenuEntry[]): CompoundMenuNode {
		const groups: GroupImpl[] = [];
		let current: MenuNode[] = [];

		const flush = (): void => {
			if (!current.length) {
				return;
			}
			const group = new GroupImpl(`custom-context-menu-${target.id}-${groups.length}`, groups.length.toString().padStart(4, '0'));
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

		const customized = Object.create(menu) as CompoundMenuNode;
		Object.defineProperty(customized, 'children', {
			value: groups,
			writable: true,
			configurable: true,
			enumerable: true
		});
		return customized;
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
					node: child
				});
			}
		}

		return this.sanitizeDefaultSeparators(result);
	}

	protected toEditable(entry: DefaultMenuEntry): EditableMenuEntry {
		if (entry.type === 'separator') {
			return {
				type: 'separator',
				key: entry.key
			};
		}
		const { node: _node, ...editable } = entry;
		return editable;
	}

	protected toStored(entry: EditableMenuEntry): StoredMenuEntry {
		if (entry.type === 'separator') {
			return {
				type: 'separator',
				key: entry.key
			};
		}
		return {
			type: 'item',
			key: entry.key,
			commandId: entry.custom ? entry.commandId : undefined
		};
	}

	protected sanitizeDefaultSeparators(entries: DefaultMenuEntry[]): DefaultMenuEntry[] {
		return this.sanitizeSeparators(entries);
	}

	protected sanitizeEditableSeparators(entries: EditableMenuEntry[]): EditableMenuEntry[] {
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

	protected pathsEqual(left: MenuPath, right: MenuPath): boolean {
		return left.length === right.length && left.every((segment, index) => segment === right[index]);
	}
}
