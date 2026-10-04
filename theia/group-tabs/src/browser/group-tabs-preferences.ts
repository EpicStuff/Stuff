import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

export const GROUP_TABS_REMEMBER_GROUPS = 'groupTabs.rememberGroups';

export const GroupTabsPreferenceSchema: PreferenceSchema = {
	title: 'Group Tabs',
	properties: {
		[GROUP_TABS_REMEMBER_GROUPS]: {
			type: 'boolean',
			default: true,
			description: 'Remember manually grouped widget relationships and automatically group matching widgets in the future.'
		}
	}
};
