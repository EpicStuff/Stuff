import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ToolbarIconDialogFactory } from '@theia/toolbar/lib/browser/toolbar-icon-selector-dialog';
import {
	ContextMenuConfigEditor,
	ContextMenuConfigEditorState
} from './custom-context-menu-editor';
import { CustomContextMenuService } from './custom-context-menu-service';

@injectable()
export class ContextMenuConfigWidget extends ReactWidget {
	static readonly ID = 'custom-context-menu.config';
	static readonly LABEL = 'Context Menus';

	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(QuickCommandService)
	protected readonly quickCommandService!: QuickCommandService;

	@inject(ToolbarIconDialogFactory)
	protected readonly iconDialogFactory!: ToolbarIconDialogFactory;

	protected editor: ContextMenuConfigEditor | undefined;
	protected pendingState: ContextMenuConfigEditorState | undefined;

	@postConstruct()
	protected init(): void {
		this.id = ContextMenuConfigWidget.ID;
		this.title.label = ContextMenuConfigWidget.LABEL;
		this.title.caption = 'Configure Context Menus';
		this.title.iconClass = codicon('list-tree');
		this.title.closable = true;
		this.node.style.height = '100%';
		this.update();
	}

	adoptState(state: ContextMenuConfigEditorState): void {
		this.pendingState = state;
		if (this.editor) {
			this.editor.restoreState(state);
			this.pendingState = undefined;
		}
		this.update();
	}

	protected render(): React.ReactNode {
		return (
			<div
				style={{
					boxSizing: 'border-box',
					height: '100%',
					padding: '12px',
					width: '100%'
				}}
			>
				<ContextMenuConfigEditor
					ref={editor => {
						this.editor = editor ?? undefined;
						if (this.editor && this.pendingState) {
							const state = this.pendingState;
							this.pendingState = undefined;
							this.editor.restoreState(state);
						}
					}}
					service={this.service}
					quickCommandService={this.quickCommandService}
					iconDialogFactory={this.iconDialogFactory}
					height='100%'
					showApply={true}
				/>
			</div>
		);
	}
}
