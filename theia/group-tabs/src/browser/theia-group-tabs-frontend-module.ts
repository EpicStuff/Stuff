import { CommandContribution } from '@theia/core';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ContainerModule } from '@theia/core/shared/inversify';
import { GroupTabsContribution } from './group-tabs-contribution';
import { GroupTabsService } from './group-tabs-service';
import { GroupTabsWidget } from './group-tabs-widget';

export default new ContainerModule(bind => {
	bind(GroupTabsService).toSelf().inSingletonScope();
	// Created through the WidgetManager so ShellLayoutRestorer stores groups and their panes.
	bind(WidgetFactory).toConstantValue({
		id: GroupTabsWidget.FACTORY_ID,
		createWidget: (options: GroupTabsWidget.Options) => new GroupTabsWidget(options)
	});

	bind(GroupTabsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(GroupTabsContribution);
	bind(CommandContribution).toService(GroupTabsContribution);
	bind(TabBarToolbarContribution).toService(GroupTabsContribution);
});
