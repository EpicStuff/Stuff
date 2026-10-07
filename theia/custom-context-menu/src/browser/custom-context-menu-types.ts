import { MANAGE_MENU, MenuPath, PreferenceSchema } from '@theia/core';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { NAVIGATOR_CONTEXT_MENU } from '@theia/navigator/lib/browser/navigator-contribution';

export const CUSTOM_CONTEXT_MENU_LAYOUTS = 'customContextMenu.layouts';

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
			description: 'Saved layouts for the native custom context menu extension.'
		}
	}
};

export interface EditableMenuItem {
	type: 'item';
	key: string;
	label: string;
	commandId?: string;
	when?: string;
	icon?: string;
	custom: boolean;
	submenu: boolean;
}

export interface EditableMenuSeparator {
	type: 'separator';
	key: string;
}

export type EditableMenuEntry = EditableMenuItem | EditableMenuSeparator;

export interface StoredMenuItem {
	type: 'item';
	key: string;
	commandId?: string;
}

export interface StoredMenuSeparator {
	type: 'separator';
	key: string;
}

export type StoredMenuEntry = StoredMenuItem | StoredMenuSeparator;

export interface StoredMenuLayout {
	entries: StoredMenuEntry[];
	knownDefaultKeys: string[];
}

export type StoredMenuLayouts = Record<string, StoredMenuLayout>;

export interface ContextMenuConfigurationChanges {
	layouts: Record<string, EditableMenuEntry[]>;
	resets: string[];
}
