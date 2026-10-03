import { Command, CommandContribution, CommandRegistry, Disposable, Emitter, MenuContribution, MenuModelRegistry, URI } from '@theia/core';
import { ApplicationShell, codicon, StorageService } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { CellKind } from '@theia/notebook/lib/common';
import { NotebookMenus } from '@theia/notebook/lib/browser/contributions/notebook-actions-contribution';
import { NotebookCellActionContribution } from '@theia/notebook/lib/browser/contributions/notebook-cell-actions-contribution';
import { NotebookEditorWidget } from '@theia/notebook/lib/browser/notebook-editor-widget';
import { NotebookEditorWidgetService } from '@theia/notebook/lib/browser/service/notebook-editor-widget-service';
import { NotebookService } from '@theia/notebook/lib/browser/service/notebook-service';
import { NotebookCodeCellRenderer } from '@theia/notebook/lib/browser/view/notebook-code-cell-view';
import { NotebookCellToolbarProps } from '@theia/notebook/lib/browser/view/notebook-cell-toolbar';
import { NotebookCellToolbarFactory } from '@theia/notebook/lib/browser/view/notebook-cell-toolbar-factory';
import { observeCellHeight } from '@theia/notebook/lib/browser/view/notebook-cell-list-view';
import { NotebookCellModel } from '@theia/notebook/lib/browser/view-model/notebook-cell-model';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';

const INPUT_COLLAPSE_STORAGE_KEY = 'theia-webview-context-fix.notebook-input-collapse';

type PersistedInputCollapseState = Record<string, number[]>;

const inputCollapseState = new WeakMap<NotebookCellModel, boolean>();
const inputCollapseStateTouched = new WeakSet<NotebookCellModel>();
const notebookByCell = new WeakMap<NotebookCellModel, NotebookModel>();
const trackedNotebooks = new WeakSet<NotebookModel>();
const inputCollapseStateChangedEmitter = new Emitter<NotebookCellModel>();

let inputCollapseStorageService: StorageService | undefined;
let persistedInputCollapseState: PersistedInputCollapseState = {};
let inputCollapseStorageReady: Promise<void> = Promise.resolve();

function notebookStorageKey(notebook: NotebookModel): string {
	return notebook.uri.toString();
}

function trackNotebook(notebook: NotebookModel): void {
	for (const cell of notebook.cells) {
		notebookByCell.set(cell, notebook);
	}

	void inputCollapseStorageReady.then(() => restoreNotebookInputCollapseState(notebook));
	if (trackedNotebooks.has(notebook)) {
		return;
	}
	trackedNotebooks.add(notebook);

	notebook.onDidAddOrRemoveCell(() => {
		for (const cell of notebook.cells) {
			notebookByCell.set(cell, notebook);
		}
		void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
	});
}

function restoreNotebookInputCollapseState(notebook: NotebookModel): void {
	const stored = persistedInputCollapseState[notebookStorageKey(notebook)];
	if (!stored) {
		return;
	}

	const collapsedIndices = new Set(stored);
	notebook.cells.forEach((cell, index) => {
		notebookByCell.set(cell, notebook);
		if (cell.cellKind !== CellKind.Code || inputCollapseStateTouched.has(cell)) {
			return;
		}

		const collapsed = collapsedIndices.has(index);
		if (isInputCollapsed(cell) !== collapsed) {
			inputCollapseState.set(cell, collapsed);
			inputCollapseStateChangedEmitter.fire(cell);
		}
	});
}

async function persistNotebookInputCollapseState(notebook: NotebookModel): Promise<void> {
	if (!inputCollapseStorageService) {
		return;
	}

	const collapsedIndices = notebook.cells.flatMap((cell, index) =>
		cell.cellKind === CellKind.Code && isInputCollapsed(cell) ? [index] : []
	);
	const key = notebookStorageKey(notebook);
	const nextState = { ...persistedInputCollapseState };
	if (collapsedIndices.length > 0) {
		nextState[key] = collapsedIndices;
	} else {
		delete nextState[key];
	}
	persistedInputCollapseState = nextState;
	await inputCollapseStorageService.setData(INPUT_COLLAPSE_STORAGE_KEY, nextState);
}

function initializeInputCollapsePersistence(storageService: StorageService, notebookEditorWidgetService: NotebookEditorWidgetService): void {
	inputCollapseStorageService = storageService;
	inputCollapseStorageReady = storageService.getData<PersistedInputCollapseState>(INPUT_COLLAPSE_STORAGE_KEY, {}).then(state => {
		persistedInputCollapseState = state ?? {};
		for (const editor of notebookEditorWidgetService.getNotebookEditors()) {
			trackNotebook(editor.model);
		}
	});

	notebookEditorWidgetService.onDidAddNotebookEditor(editor => {
		trackNotebook(editor.model);
	});
}

function isInputCollapsed(cell: NotebookCellModel): boolean {
	const stored = inputCollapseState.get(cell);
	if (stored !== undefined) {
		return stored;
	}

	const collapsed = cell.getData().collapseState?.inputCollapsed ?? false;
	inputCollapseState.set(cell, collapsed);
	return collapsed;
}

function setInputCollapsed(cell: NotebookCellModel, collapsed: boolean, persist: boolean = true): void {
	inputCollapseStateTouched.add(cell);
	if (isInputCollapsed(cell) === collapsed) {
		return;
	}

	inputCollapseState.set(cell, collapsed);
	inputCollapseStateChangedEmitter.fire(cell);

	if (persist) {
		const notebook = notebookByCell.get(cell);
		if (notebook) {
			void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
		}
	}
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

interface DynamicCellToolbarProps {
	cell: NotebookCellModel;
	renderToolbar: () => React.ReactNode;
}

interface DynamicCellToolbarState {
	collapsed: boolean;
}

class DynamicCellToolbar extends React.Component<DynamicCellToolbarProps, DynamicCellToolbarState> {
	protected stateSubscription?: Disposable;

	constructor(props: DynamicCellToolbarProps) {
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
		const toolbar = this.props.renderToolbar();
		if (!React.isValidElement<NotebookCellToolbarProps>(toolbar)) {
			return toolbar;
		}

		return React.cloneElement(toolbar, {
			key: this.state.collapsed ? 'collapsed' : 'expanded'
		});
	}
}

let toolbarPatched = false;

export function patchNotebookCellToolbarInputCollapseIcon(): void {
	if (toolbarPatched) {
		return;
	}
	toolbarPatched = true;

	const originalRenderCellToolbar = NotebookCellToolbarFactory.prototype.renderCellToolbar;
	NotebookCellToolbarFactory.prototype.renderCellToolbar = function (
		this: NotebookCellToolbarFactory,
		menuPath: string[],
		cell: NotebookCellModel,
		itemOptions
	): React.ReactNode {
		return React.createElement(DynamicCellToolbar, {
			cell,
			renderToolbar: () => {
				const toolbar = originalRenderCellToolbar.call(this, menuPath, cell, itemOptions);
				if (!React.isValidElement<NotebookCellToolbarProps>(toolbar)) {
					return toolbar;
				}

				const getMenuItems = toolbar.props.getMenuItems;
				return React.cloneElement(toolbar, {
					getMenuItems: () => getMenuItems().map(item => {
						if (item.id !== NotebookCellInputCollapseCommands.TOGGLE.id) {
							return item;
						}

						const collapsed = isInputCollapsed(cell);
						return {
							...item,
							icon: codicon(collapsed ? 'unfold' : 'fold'),
							label: collapsed ? 'Expand Cell Input' : 'Collapse Cell Input'
						};
					})
				});
			}
		});
	};
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
		trackNotebook(notebookModel);
		notebookByCell.set(cell, notebookModel);
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

	export const COLLAPSE_ALL_CODE_INPUTS: Command = {
		id: 'notebook.cell.collapseAllCodeInputs',
		label: 'Fold All Code Cells',
		category: 'Notebook'
	};
}

@injectable()
export class NotebookCellInputCollapseContribution implements CommandContribution, MenuContribution {
	@inject(NotebookEditorWidgetService)
	protected readonly notebookEditorWidgetService!: NotebookEditorWidgetService;

	@inject(ApplicationShell)
	protected readonly applicationShell!: ApplicationShell;

	@inject(StorageService)
	protected readonly storageService!: StorageService;

	@inject(NotebookService)
	protected readonly notebookService!: NotebookService;

	@postConstruct()
	protected init(): void {
		initializeInputCollapsePersistence(this.storageService, this.notebookEditorWidgetService);
	}

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

		commands.registerCommand(NotebookCellInputCollapseCommands.COLLAPSE_ALL_CODE_INPUTS, {
			isEnabled: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				return !!notebook?.cells.some(cell => cell.cellKind === CellKind.Code && !isInputCollapsed(cell));
			},
			isVisible: (item?: URI | NotebookModel) => !!this.resolveNotebook(item),
			execute: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				if (!notebook) {
					return;
				}

				trackNotebook(notebook);
				for (const cell of notebook.cells) {
					if (cell.cellKind === CellKind.Code) {
						setInputCollapsed(cell, true, false);
					}
				}
				void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
			}
		});
	}

	registerMenus(menus: MenuModelRegistry): void {
		menus.registerMenuAction(NotebookCellActionContribution.ACTION_MENU, {
			commandId: NotebookCellInputCollapseCommands.TOGGLE.id,
			label: 'Toggle Cell Input',
			icon: codicon('fold'),
			order: '25'
		});
		menus.registerMenuAction(NotebookMenus.NOTEBOOK_MAIN_TOOLBAR_EXECUTION_GROUP, {
			commandId: NotebookCellInputCollapseCommands.COLLAPSE_ALL_CODE_INPUTS.id,
			label: 'Fold All Code Cells',
			icon: codicon('fold'),
			order: '20'
		});
	}

	protected resolveCell(first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel): NotebookCellModel | undefined {
		if (first instanceof NotebookCellModel) {
			return first;
		}
		if (second) {
			return second;
		}

		const currentWidget = this.applicationShell.currentWidget;
		return currentWidget instanceof NotebookEditorWidget ? currentWidget.viewModel.selectedCell : undefined;
	}

	protected resolveNotebook(item?: URI | NotebookModel): NotebookModel | undefined {
		if (item instanceof NotebookModel) {
			return item;
		}
		if (item instanceof URI) {
			return this.notebookService.getNotebookEditorModel(item);
		}

		const currentWidget = this.applicationShell.currentWidget;
		return currentWidget instanceof NotebookEditorWidget ? currentWidget.model : undefined;
	}
}
