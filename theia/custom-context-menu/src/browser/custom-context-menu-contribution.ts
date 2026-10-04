import {
	Command,
	CommandContribution,
	CommandRegistry,
	MANAGE_MENU,
	MenuContribution,
	MenuModelRegistry
} from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ContextMenuConfigDialogFactory } from './custom-context-menu-dialog';
import { CustomContextMenuService } from './custom-context-menu-service';

export namespace CustomContextMenuCommands {
	export const CONFIGURE: Command = {
		id: 'custom-context-menu.configure',
		label: 'Custom Context Menu: Configure'
	};
}

@injectable()
export class CustomContextMenuContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(ContextMenuConfigDialogFactory)
	protected readonly dialogFactory!: ContextMenuConfigDialogFactory;

	onStart(): void {
		this.service.installRendererPatch();
	}

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(CustomContextMenuCommands.CONFIGURE, {
			execute: async () => {
				const dialog = this.dialogFactory();
				const changes = await dialog.open();
				if (changes) {
					await this.service.applyChanges(changes);
				}
			}
		});
	}

	registerMenus(menus: MenuModelRegistry): void {
		menus.registerMenuAction([...MANAGE_MENU, '9_custom_context_menu'], {
			commandId: CustomContextMenuCommands.CONFIGURE.id,
			order: '0'
		});
	}
}
