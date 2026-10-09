import { Disposable } from '@theia/core';
import {
	ApplicationShell,
	codicon,
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

		this.addOpenInTabTitleAction();

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

	protected addOpenInTabTitleAction(): void {
		const titleBar = this.closeCrossNode.parentElement;
		if (!titleBar) {
			return;
		}

		const actions = this.node.ownerDocument.createElement('div');
		actions.style.alignItems = 'center';
		actions.style.display = 'flex';
		actions.style.gap = '8px';

		const openInTab = this.node.ownerDocument.createElement('i');
		openInTab.className = codicon('open-in-product');
		openInTab.setAttribute('aria-label', 'Open in Tab');
		openInTab.setAttribute('role', 'button');
		openInTab.setAttribute('tabindex', '0');
		openInTab.title = 'Open in Tab';
		openInTab.style.cursor = 'pointer';
		openInTab.style.display = 'inline-flex';
		openInTab.style.alignItems = 'center';
		openInTab.style.justifyContent = 'center';
		openInTab.style.minHeight = '22px';
		openInTab.style.minWidth = '22px';

		const activate = () => {
			void this.openInTab();
		};
		const activateFromKeyboard = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				// Keeps the dialog's document level Enter handler from also accepting the dialog.
				event.stopPropagation();
				activate();
			}
		};
		openInTab.addEventListener('click', activate);
		openInTab.addEventListener('keydown', activateFromKeyboard);
		this.toDispose.push(Disposable.create(() => {
			openInTab.removeEventListener('click', activate);
			openInTab.removeEventListener('keydown', activateFromKeyboard);
		}));

		titleBar.removeChild(this.closeCrossNode);
		actions.appendChild(openInTab);
		actions.appendChild(this.closeCrossNode);
		titleBar.appendChild(actions);
	}

	protected override handleEnter(event: KeyboardEvent): boolean | void {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
			return false;
		}
		return super.handleEnter(event);
	}

	protected async openInTab(): Promise<void> {
		const state = this.editor?.captureState();
		const widget = await this.widgetManager.getOrCreateWidget(ContextMenuConfigWidget.ID);
		if (!(widget instanceof ContextMenuConfigWidget)) {
			return;
		}
		if (state) {
			widget.adoptState(state);
		}
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
