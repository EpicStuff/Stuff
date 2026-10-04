import { MANAGE_MENU, MenuPath, PreferenceSchema } from '@theia/core';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { NAVIGATOR_CONTEXT_MENU } from '@theia/navigator/lib/browser/navigator-contribution';
import { WEBVIEW_CONTEXT_MENU } from '@theia/plugin-ext/lib/main/browser/webview/webview';

export const CUSTOM_CONTEXT_MENU_LAYOUTS = 'customContextMenu.layouts';
export const CUSTOM_CONTEXT_MENU_OPEN_MODE = 'customContextMenu.openMode';

export type ContextMenuOpenMode = 'dialog' | 'tab';

export interface ContextMenuTarget {
	id: string;
	label: string;
	path: MenuPath;
}

export const CONTEXT_MENU_TARGETS: ContextMenuTarget[] = [
	{
		id: 'editor',
		label: 'Editor Right Click',
		path: EDITOR_CONTEXT_MENU
	},
	{
		id: 'explorer',
		label: 'Explorer Right Click',
		path: NAVIGATOR_CONTEXT_MENU
	},
	{
		id: 'settings',
		label: 'Settings Gear Menu',
		path: MANAGE_MENU
	},
	{
		id: 'webview',
		label: 'Webview Right Click (GitLens, etc.)',
		path: WEBVIEW_CONTEXT_MENU
	}
];

export const CustomContextMenuPreferenceSchema: PreferenceSchema = {
	title: 'Custom Context Menu',
	properties: {
		[CUSTOM_CONTEXT_MENU_LAYOUTS]: {
			type: 'object',
			default: {},
			additionalProperties: true,
			hidden: true,
			description: 'Sparse layout customizations for context menus.'
		},
		[CUSTOM_CONTEXT_MENU_OPEN_MODE]: {
			type: 'string',
			enum: ['dialog', 'tab'],
			default: 'dialog',
			title: 'Open Mode',
			description: 'Controls whether Custom Context Menu: Configure opens as a popup dialog or a main area tab.'
		}
	}
};

export interface EditableMenuItem {
	type: 'item';
	key: string;
	storageKey: string;
	label: string;
	commandId?: string;
	when?: string;
	icon?: string;
	custom: boolean;
	submenu: boolean;
	customSubmenu?: boolean;
	children?: EditableMenuEntry[];
	defaultLabel?: string;
	defaultWhen?: string;
	defaultIcon?: string;
	defaultGroup?: string;
	labelOverride?: string;
	whenOverride?: string;
	iconOverride?: string;
}

export interface EditableMenuSeparator {
	type: 'separator';
	key: string;
	storageKey: string;
	custom: boolean;
	group?: string;
}

export type EditableMenuEntry = EditableMenuItem | EditableMenuSeparator;

export type StoredMenuPosition = 'start' | 'end';

export interface StoredMenuPlacement {
	parent?: string | null;
	group?: string;
	at?: StoredMenuPosition;
	before?: string;
	after?: string;
	beforeGroup?: string;
	afterGroup?: string;
}

export interface StoredMenuEdit extends StoredMenuPlacement {
	label?: string;
	when?: string | null;
	icon?: string | null;
}

export interface StoredCommandAdd extends StoredMenuPlacement {
	type: 'command';
	command: string;
	label?: string;
	when?: string | null;
	icon?: string | null;
}

export interface StoredSubmenuAdd extends StoredMenuPlacement {
	type: 'submenu';
	label: string;
	when?: string | null;
	icon?: string | null;
}

export interface StoredSeparatorAdd extends StoredMenuPlacement {
	type: 'separator';
}

export type StoredMenuAdd = StoredCommandAdd | StoredSubmenuAdd | StoredSeparatorAdd;

export interface StoredMenuLayout {
	hide?: string[];
	edit?: Record<string, StoredMenuEdit>;
	add?: Record<string, StoredMenuAdd>;
}

export type StoredMenuLayouts = Record<string, StoredMenuLayout>;

export interface ContextMenuConfigurationChanges {
	layouts: Record<string, EditableMenuEntry[]>;
	resets: string[];
}
