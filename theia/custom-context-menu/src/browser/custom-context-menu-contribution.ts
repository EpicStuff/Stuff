import {
	Command,
	CommandContribution,
	CommandRegistry,
	MANAGE_MENU,
	MenuContribution,
	MenuModelRegistry
} from '@theia/core';
import {
	ApplicationShell,
	FrontendApplicationContribution,
	WidgetManager
} from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ContextMenuConfigDialogFactory } from './custom-context-menu-dialog';
import { CustomContextMenuService } from './custom-context-menu-service';
import { ContextMenuConfigWidget } from './custom-context-menu-widget';

export namespace CustomContextMenuCommands {
	export const CONFIGURE: Command = {
		id: 'custom-context-menu.configure',
		label: 'Custom Context Menu: Configure'
	};

	export const CONFIGURE_DIALOG: Command = {
		id: 'custom-context-menu.configureDialog',
		label: 'Custom Context Menu: Configure in Dialog'
	};
}

@injectable()
export class CustomContextMenuContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(ContextMenuConfigDialogFactory)
	protected readonly dialogFactory!: ContextMenuConfigDialogFactory;

	@inject(WidgetManager)
	protected readonly widgetManager!: WidgetManager;

	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	onStart(): void {
		this.service.installRendererPatch();
	}

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(CustomContextMenuCommands.CONFIGURE, {
			execute: () => this.openConfigTab()
		});

		commands.registerCommand(CustomContextMenuCommands.CONFIGURE_DIALOG, {
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
			label: 'Configure Context Menus',
			order: '0'
		});
	}

	protected async openConfigTab(): Promise<void> {
		const widget = await this.widgetManager.getOrCreateWidget(ContextMenuConfigWidget.ID);
		if (!widget.isAttached) {
			await this.shell.addWidget(widget, {
				area: 'main'
			});
		}
		await this.shell.activateWidget(widget.id);
	}
}
