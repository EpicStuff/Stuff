import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

export const GROUP_TABS_REMEMBER_GROUPS = 'groupTabs.rememberGroups';

export const GroupTabsPreferenceSchema: PreferenceSchema = {
	title: 'Group Tabs',
	properties: {
		[GROUP_TABS_REMEMBER_GROUPS]: {
			type: 'boolean',
			default: true,
			description: 'Remember the layout of manually grouped tabs and automatically group matching tabs in the future.'
		}
	}
};
