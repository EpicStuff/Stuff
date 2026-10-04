import { Disposable } from '@theia/core';
import {
	ApplicationShell,
	Dialog,
	DialogProps,
	WidgetManager
} from '@theia/core/lib/browser';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { inject, injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ToolbarIconDialogFactory } from '@theia/toolbar/lib/browser/toolbar-icon-selector-dialog';
import { ContextMenuConfigEditor } from './custom-context-menu-editor';
import { CustomContextMenuService } from './custom-context-menu-service';
import { ContextMenuConfigurationChanges } from './custom-context-menu-types';
import { ContextMenuConfigWidget } from './custom-context-menu-widget';

export const ContextMenuConfigDialogFactory = Symbol('ContextMenuConfigDialogFactory');
export interface ContextMenuConfigDialogFactory {
	(): ContextMenuConfigDialog;
}

@injectable()
export class ContextMenuConfigDialog extends ReactDialog<ContextMenuConfigurationChanges> {
	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(QuickCommandService)
	protected readonly quickCommandService!: QuickCommandService;

	@inject(ToolbarIconDialogFactory)
	protected readonly iconDialogFactory!: ToolbarIconDialogFactory;

	@inject(WidgetManager)
	protected readonly widgetManager!: WidgetManager;

	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	protected editor: ContextMenuConfigEditor | undefined;

	constructor(
		@inject(DialogProps) protected override readonly props: DialogProps
	) {
		super(props);
	}

	@postConstruct()
	protected init(): void {
		this.node.id = 'custom-context-menu-config-dialog';
		this.contentNode.style.minWidth = '760px';
		this.contentNode.style.width = 'min(900px, 82vw)';
		this.contentNode.style.minHeight = '520px';
		this.contentNode.style.maxHeight = '78vh';
		this.contentNode.style.overflow = 'hidden';

		const openInTabButton = this.appendButton('Open in Tab', false);
		const openInTab = () => {
			void this.openInTab();
		};
		openInTabButton.addEventListener('click', openInTab);
		this.toDispose.push(Disposable.create(() => openInTabButton.removeEventListener('click', openInTab)));

		this.appendCloseButton(Dialog.CANCEL);
		this.appendAcceptButton('Save');
	}

	get value(): ContextMenuConfigurationChanges {
		return this.editor?.getChanges() ?? {
			layouts: {},
			resets: []
		};
	}

	protected render(): React.ReactNode {
		return (
			<ContextMenuConfigEditor
				ref={editor => {
					this.editor = editor ?? undefined;
				}}
				service={this.service}
				quickCommandService={this.quickCommandService}
				iconDialogFactory={this.iconDialogFactory}
				height='520px'
			/>
		);
	}

	protected override handleEnter(event: KeyboardEvent): boolean | void {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
			return false;
		}
		return super.handleEnter(event);
	}

	protected async openInTab(): Promise<void> {
		await this.service.applyChanges(this.value);
		const widget = await this.widgetManager.getOrCreateWidget(ContextMenuConfigWidget.ID);
		if (!widget.isAttached) {
			await this.shell.addWidget(widget, {
				area: 'main'
			});
		}
		await this.shell.activateWidget(widget.id);
		this.close();
	}
}

export function bindContextMenuConfigDialog(bind: interfaces.Bind): void {
	bind(ContextMenuConfigDialogFactory).toFactory(context => (): ContextMenuConfigDialog => {
		const child = context.container.createChild();
		child.bind(DialogProps).toConstantValue({
			title: 'Configure Context Menus',
			maxWidth: 940
		});
		child.bind(ContextMenuConfigDialog).toSelf();
		return child.get(ContextMenuConfigDialog);
	});
}
