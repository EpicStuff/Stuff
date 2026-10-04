import { Dialog, DialogProps } from '@theia/core/lib/browser';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { inject, injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ContextMenuConfigEditor } from './custom-context-menu-editor';
import { CustomContextMenuService } from './custom-context-menu-service';
import { ContextMenuConfigurationChanges } from './custom-context-menu-types';

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
				height='520px'
			/>
		);
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
