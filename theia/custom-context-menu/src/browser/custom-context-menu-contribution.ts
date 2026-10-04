import {
	Command,
	CommandContribution,
	CommandRegistry,
	MANAGE_MENU,
	MenuContribution,
	MenuModelRegistry,
	PreferenceService
} from '@theia/core';
import {
	ApplicationShell,
	FrontendApplicationContribution,
	WidgetManager
} from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ContextMenuConfigDialogFactory } from './custom-context-menu-dialog';
import { CustomContextMenuService } from './custom-context-menu-service';
import {
	CUSTOM_CONTEXT_MENU_OPEN_MODE,
	ContextMenuOpenMode
} from './custom-context-menu-types';
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

	export const CONFIGURE_TAB: Command = {
		id: 'custom-context-menu.configureTab',
		label: 'Custom Context Menu: Configure in Tab'
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

	@inject(PreferenceService)
	protected readonly preferenceService!: PreferenceService;

	onStart(): void {
		this.service.installRendererPatch();
	}

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(CustomContextMenuCommands.CONFIGURE, {
			execute: () => this.openConfiguredMode()
		});

		commands.registerCommand(CustomContextMenuCommands.CONFIGURE_DIALOG, {
			execute: () => this.openConfigDialog()
		});

		commands.registerCommand(CustomContextMenuCommands.CONFIGURE_TAB, {
			execute: () => this.openConfigTab()
		});
	}

	registerMenus(menus: MenuModelRegistry): void {
		menus.registerMenuAction([...MANAGE_MENU, '9_custom_context_menu'], {
			commandId: CustomContextMenuCommands.CONFIGURE.id,
			label: 'Configure Context Menus',
			order: '0'
		});
	}

	protected async openConfiguredMode(): Promise<void> {
		const mode = this.preferenceService.get<ContextMenuOpenMode>(CUSTOM_CONTEXT_MENU_OPEN_MODE, 'dialog');
		if (mode === 'tab') {
			await this.openConfigTab();
		} else {
			await this.openConfigDialog();
		}
	}

	protected async openConfigDialog(): Promise<void> {
		const dialog = this.dialogFactory();
		const changes = await dialog.open();
		if (changes) {
			await this.service.applyChanges(changes);
		}
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
