import { CommandContribution, MenuContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { ContainerModule } from '@theia/core/shared/inversify';
import { bindContextMenuConfigDialog } from './custom-context-menu-dialog';
import { CustomContextMenuContribution } from './custom-context-menu-contribution';
import { CustomContextMenuService } from './custom-context-menu-service';
import { CustomContextMenuPreferenceSchema } from './custom-context-menu-types';

export default new ContainerModule(bind => {
	bind(CustomContextMenuService).toSelf().inSingletonScope();

	bind(CustomContextMenuContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CustomContextMenuContribution);
	bind(CommandContribution).toService(CustomContextMenuContribution);
	bind(MenuContribution).toService(CustomContextMenuContribution);

	bind(PreferenceContribution).toConstantValue({
		schema: CustomContextMenuPreferenceSchema
	});

	bindContextMenuConfigDialog(bind);
});
