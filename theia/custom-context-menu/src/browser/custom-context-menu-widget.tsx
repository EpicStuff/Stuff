import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ContextMenuConfigEditor } from './custom-context-menu-editor';
import { CustomContextMenuService } from './custom-context-menu-service';

@injectable()
export class ContextMenuConfigWidget extends ReactWidget {
	static readonly ID = 'custom-context-menu.config';
	static readonly LABEL = 'Context Menus';

	@inject(CustomContextMenuService)
	protected readonly service!: CustomContextMenuService;

	@inject(QuickCommandService)
	protected readonly quickCommandService!: QuickCommandService;

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
					service={this.service}
					quickCommandService={this.quickCommandService}
					height='100%'
					showApply={true}
				/>
			</div>
		);
	}
}
