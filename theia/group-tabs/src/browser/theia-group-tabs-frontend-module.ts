import { CommandContribution } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ContainerModule } from '@theia/core/shared/inversify';
import { GroupTabsContribution } from './group-tabs-contribution';
import { GroupTabsPreferenceSchema } from './group-tabs-preferences';
import { GroupTabsService } from './group-tabs-service';
import { GroupTabsWidget } from './group-tabs-widget';

export default new ContainerModule(bind => {
	bind(PreferenceContribution).toConstantValue({ schema: GroupTabsPreferenceSchema });

	bind(GroupTabsService).toSelf().inSingletonScope();
	bind(WidgetFactory).toDynamicValue(({ container }) => ({
		id: GroupTabsWidget.FACTORY_ID,
		createWidget: (options: GroupTabsWidget.Options) => new GroupTabsWidget(options, container.get(ApplicationShell))
	})).inSingletonScope();

	bind(GroupTabsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(GroupTabsContribution);
	bind(CommandContribution).toService(GroupTabsContribution);
	bind(TabBarToolbarContribution).toService(GroupTabsContribution);
});
