import { Command, CommandContribution, CommandRegistry, Disposable, Emitter, MenuContribution, MenuModelRegistry } from '@theia/core';
import { codicon } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { CellKind } from '@theia/notebook/lib/common';
import { NotebookCellActionContribution } from '@theia/notebook/lib/browser/contributions/notebook-cell-actions-contribution';
import { NotebookEditorWidgetService } from '@theia/notebook/lib/browser/service/notebook-editor-widget-service';
import { NotebookCodeCellRenderer } from '@theia/notebook/lib/browser/view/notebook-code-cell-view';
import { observeCellHeight } from '@theia/notebook/lib/browser/view/notebook-cell-list-view';
import { NotebookCellModel } from '@theia/notebook/lib/browser/view-model/notebook-cell-model';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';

const inputCollapseState = new WeakMap<NotebookCellModel, boolean>();
const inputCollapseStateChangedEmitter = new Emitter<NotebookCellModel>();

function isInputCollapsed(cell: NotebookCellModel): boolean {
	const stored = inputCollapseState.get(cell);
	if (stored !== undefined) {
		return stored;
	}

	const collapsed = cell.getData().collapseState?.inputCollapsed ?? false;
	inputCollapseState.set(cell, collapsed);
	return collapsed;
}

function setInputCollapsed(cell: NotebookCellModel, collapsed: boolean): void {
	if (isInputCollapsed(cell) === collapsed) {
		return;
	}

	inputCollapseState.set(cell, collapsed);
	inputCollapseStateChangedEmitter.fire(cell);
}

interface CollapsibleCodeCellInputProps {
	cell: NotebookCellModel;
	renderExpanded: () => React.ReactNode;
}

interface CollapsibleCodeCellInputState {
	collapsed: boolean;
}

class CollapsibleCodeCellInput extends React.Component<CollapsibleCodeCellInputProps, CollapsibleCodeCellInputState> {
	protected stateSubscription?: Disposable;

	constructor(props: CollapsibleCodeCellInputProps) {
		super(props);
		this.state = { collapsed: isInputCollapsed(props.cell) };
	}

	override componentDidMount(): void {
		this.stateSubscription = inputCollapseStateChangedEmitter.event(cell => {
			if (cell === this.props.cell) {
				this.setState({ collapsed: isInputCollapsed(cell) });
			}
		});
	}

	override componentWillUnmount(): void {
		this.stateSubscription?.dispose();
	}

	override render(): React.ReactNode {
		if (!this.state.collapsed) {
			return this.props.renderExpanded();
		}

		return React.createElement(
			'div',
			{
				className: 'theia-notebook-cell-with-sidebar',
				ref: (ref: HTMLDivElement | null) => observeCellHeight(ref, this.props.cell)
			},
			React.createElement(
				'div',
				{
					className: 'theia-notebook-cell-editor-container',
					title: 'Expand Cell Input',
					onClick: () => setInputCollapsed(this.props.cell, false),
					style: {
						alignItems: 'center',
						cursor: 'pointer',
						display: 'flex',
						minHeight: '24px',
						opacity: 0.7,
						padding: '0 10px'
					}
				},
				React.createElement('span', { className: codicon('chevron-right'), style: { marginRight: '6px' } }),
				React.createElement('span', undefined, 'Cell input is collapsed')
			)
		);
	}
}

let rendererPatched = false;

export function patchNotebookCodeCellInputCollapse(): void {
	if (rendererPatched) {
		return;
	}
	rendererPatched = true;

	const originalRender = NotebookCodeCellRenderer.prototype.render;
	NotebookCodeCellRenderer.prototype.render = function (
		this: NotebookCodeCellRenderer,
		notebookModel: NotebookModel,
		cell: NotebookCellModel,
		handle: number
	): React.ReactNode {
		return React.createElement(CollapsibleCodeCellInput, {
			cell,
			renderExpanded: () => originalRender.call(this, notebookModel, cell, handle)
		});
	};
}

export namespace NotebookCellInputCollapseCommands {
	export const COLLAPSE: Command = {
		id: 'notebook.cell.collapseCellInput',
		label: 'Collapse Cell Input',
		category: 'Notebook'
	};

	export const EXPAND: Command = {
		id: 'notebook.cell.expandCellInput',
		label: 'Expand Cell Input',
		category: 'Notebook'
	};

	export const TOGGLE: Command = {
		id: 'notebook.cell.toggleCellInput',
		label: 'Toggle Cell Input',
		category: 'Notebook'
	};
}

@injectable()
export class NotebookCellInputCollapseContribution implements CommandContribution, MenuContribution {
	@inject(NotebookEditorWidgetService)
	protected readonly notebookEditorWidgetService!: NotebookEditorWidgetService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(NotebookCellInputCollapseCommands.COLLAPSE, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return cell?.cellKind === CellKind.Code && !isInputCollapsed(cell);
			},
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return cell?.cellKind === CellKind.Code && !isInputCollapsed(cell);
			},
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell?.cellKind === CellKind.Code) {
					setInputCollapsed(cell, true);
				}
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.EXPAND, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return cell?.cellKind === CellKind.Code && isInputCollapsed(cell);
			},
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return cell?.cellKind === CellKind.Code && isInputCollapsed(cell);
			},
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell?.cellKind === CellKind.Code) {
					setInputCollapsed(cell, false);
				}
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.TOGGLE, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => this.resolveCell(first, second)?.cellKind === CellKind.Code,
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => this.resolveCell(first, second)?.cellKind === CellKind.Code,
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell?.cellKind === CellKind.Code) {
					setInputCollapsed(cell, !isInputCollapsed(cell));
				}
			}
		});
	}

	registerMenus(menus: MenuModelRegistry): void {
		for (const menu of [
			NotebookCellActionContribution.ADDITIONAL_ACTION_MENU,
			NotebookCellActionContribution.ADDITIONAL_OUTPUT_SIDEBAR_MENU
		]) {
			menus.registerMenuAction(menu, {
				commandId: NotebookCellInputCollapseCommands.TOGGLE.id,
				label: 'Toggle Cell Input',
				icon: codicon('fold')
			});
		}
	}

	protected resolveCell(first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel): NotebookCellModel | undefined {
		if (first instanceof NotebookCellModel) {
			return first;
		}
		return second
			?? this.notebookEditorWidgetService.focusedEditor?.viewModel.selectedCell
			?? this.notebookEditorWidgetService.currentEditor?.viewModel.selectedCell;
	}
}
