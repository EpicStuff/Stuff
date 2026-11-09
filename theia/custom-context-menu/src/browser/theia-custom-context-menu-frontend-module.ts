import { CommandContribution, MenuContribution } from '@theia/core';
import {
	FrontendApplicationContribution,
	UndoRedoHandler,
	WidgetFactory
} from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { ContainerModule } from '@theia/core/shared/inversify';
import { bindContextMenuConfigDialog } from './custom-context-menu-dialog';
import { CustomContextMenuContribution } from './custom-context-menu-contribution';
import { ContextMenuConfigUndoRedoHandler } from './custom-context-menu-editor';
import { CustomContextMenuService } from './custom-context-menu-service';
import { CustomContextMenuPreferenceSchema } from './custom-context-menu-types';
import { ContextMenuConfigWidget } from './custom-context-menu-widget';

export default new ContainerModule(bind => {
	bind(CustomContextMenuService).toSelf().inSingletonScope();

	bind(ContextMenuConfigUndoRedoHandler).toSelf().inSingletonScope();
	bind(UndoRedoHandler).toService(ContextMenuConfigUndoRedoHandler);

	bind(ContextMenuConfigWidget).toSelf();
	bind(WidgetFactory).toDynamicValue(({ container }) => ({
		id: ContextMenuConfigWidget.ID,
		createWidget: () => container.get(ContextMenuConfigWidget)
	})).inSingletonScope();

	bind(CustomContextMenuContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CustomContextMenuContribution);
	bind(CommandContribution).toService(CustomContextMenuContribution);
	bind(MenuContribution).toService(CustomContextMenuContribution);

	bind(PreferenceContribution).toConstantValue({
		schema: CustomContextMenuPreferenceSchema
	});

	bindContextMenuConfigDialog(bind);
});
