import { CommandContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ContainerModule } from '@theia/core/shared/inversify';
import { GroupTabsContribution } from './group-tabs-contribution';
import { GroupTabsService } from './group-tabs-service';

export default new ContainerModule(bind => {
	bind(GroupTabsService).toSelf().inSingletonScope();

	bind(GroupTabsContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(GroupTabsContribution);
	bind(CommandContribution).toService(GroupTabsContribution);
	bind(TabBarToolbarContribution).toService(GroupTabsContribution);
});
