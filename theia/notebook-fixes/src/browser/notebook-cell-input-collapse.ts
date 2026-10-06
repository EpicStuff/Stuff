import { Command, CommandContribution, CommandRegistry, Disposable, Emitter, MenuContribution, MenuModelRegistry, URI } from '@theia/core';
import { ApplicationShell, codicon, StorageService } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { CellKind } from '@theia/notebook/lib/common';
import { NotebookMenus } from '@theia/notebook/lib/browser/contributions/notebook-actions-contribution';
import { NotebookCellActionContribution, NotebookCellCommands } from '@theia/notebook/lib/browser/contributions/notebook-cell-actions-contribution';
import { NotebookEditorWidget } from '@theia/notebook/lib/browser/notebook-editor-widget';
import { NotebookEditorWidgetService } from '@theia/notebook/lib/browser/service/notebook-editor-widget-service';
import { NotebookService } from '@theia/notebook/lib/browser/service/notebook-service';
import { NotebookCodeCellRenderer } from '@theia/notebook/lib/browser/view/notebook-code-cell-view';
import { observeCellHeight } from '@theia/notebook/lib/browser/view/notebook-cell-list-view';
import { NotebookMarkdownCellRenderer } from '@theia/notebook/lib/browser/view/notebook-markdown-cell-view';
import { NotebookEditorFindMatch, NotebookEditorFindMatchOptions } from '@theia/notebook/lib/browser/view/notebook-find-widget';
import { NotebookCellToolbarProps } from '@theia/notebook/lib/browser/view/notebook-cell-toolbar';
import { NotebookCellToolbarFactory } from '@theia/notebook/lib/browser/view/notebook-cell-toolbar-factory';
import { NotebookCellModel } from '@theia/notebook/lib/browser/view-model/notebook-cell-model';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';

const INPUT_COLLAPSE_STORAGE_KEY = 'theia-webview-context-fix.notebook-input-collapse';

type PersistedInputCollapseState = Record<string, number[]>;

const inputCollapseState = new WeakMap<NotebookCellModel, boolean>();
const inputCollapseStateTouched = new WeakSet<NotebookCellModel>();
const notebookByCell = new WeakMap<NotebookCellModel, NotebookModel>();
const trackedNotebooks = new WeakSet<NotebookModel>();
const notebooksReloadingFromDisk = new WeakSet<NotebookModel>();
const inputCollapseStateChangedEmitter = new Emitter<NotebookCellModel>();
const instrumentedFindMatches = new WeakSet<object>();

let autoExpandedFindCell: NotebookCellModel | undefined;

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
		if (!notebooksReloadingFromDisk.has(notebook)) {
			void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
		}
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
		if (!isInputCollapsibleCell(cell) || inputCollapseStateTouched.has(cell)) {
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
		isInputCollapsibleCell(cell) && isInputCollapsed(cell) ? [index] : []
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
			if (editor.model) {
				trackNotebook(editor.model);
			}
		}
	});

	notebookEditorWidgetService.onDidAddNotebookEditor(editor => {
		if (editor.model) {
			trackNotebook(editor.model);
		}
	});
}

export function readNotebookCellInputCollapseState(cell: NotebookCellModel): boolean {
	const stored = inputCollapseState.get(cell);
	if (stored !== undefined) {
		return stored;
	}

	const collapsed = cell.getData().collapseState?.inputCollapsed ?? false;
	inputCollapseState.set(cell, collapsed);
	return collapsed;
}

const isInputCollapsed = readNotebookCellInputCollapseState;

function isInputCollapsibleCell(cell: NotebookCellModel): boolean {
	return cell.cellKind === CellKind.Code || cell.cellKind === CellKind.Markup;
}

export async function reloadNotebookPreservingInputCollapseState(notebook: NotebookModel): Promise<void> {
	const collapsedIndices = new Set(notebook.cells.flatMap((cell, index) =>
		isInputCollapsibleCell(cell) && isInputCollapsed(cell) ? [index] : []
	));

	notebooksReloadingFromDisk.add(notebook);
	try {
		await notebook.revert();
		notebook.cells.forEach((cell, index) => {
			notebookByCell.set(cell, notebook);
			if (isInputCollapsibleCell(cell)) {
				setInputCollapsed(cell, collapsedIndices.has(index), false);
			}
		});
		await inputCollapseStorageReady;
		await persistNotebookInputCollapseState(notebook);
	} finally {
		notebooksReloadingFromDisk.delete(notebook);
	}
}

function setInputCollapsed(cell: NotebookCellModel, collapsed: boolean, persist: boolean = true): void {
	inputCollapseStateTouched.add(cell);
	if (persist && autoExpandedFindCell === cell) {
		autoExpandedFindCell = undefined;
	}
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

function escapeFindPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countCollapsedSourceMatches(cell: NotebookCellModel, options: NotebookEditorFindMatchOptions): number {
	if (!options.search) {
		return 0;
	}

	let pattern = options.regex ? options.search : escapeFindPattern(options.search);
	if (options.wholeWord) {
		pattern = `\\b(?:${pattern})\\b`;
	}

	let expression: RegExp;
	try {
		expression = new RegExp(pattern, options.matchCase ? 'g' : 'gi');
	} catch {
		return 0;
	}

	let count = 0;
	let match: RegExpExecArray | null;
	while ((match = expression.exec(cell.source)) !== null) {
		count++;
		if (match[0].length === 0) {
			expression.lastIndex++;
		}
	}
	return count;
}

function finishAutoExpandedFindCell(cell: NotebookCellModel): void {
	if (autoExpandedFindCell !== cell) {
		return;
	}
	autoExpandedFindCell = undefined;

	const notebook = notebookByCell.get(cell);
	if (notebook) {
		void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
	}
}

function prepareFindJump(cell: NotebookCellModel): boolean {
	if (autoExpandedFindCell && autoExpandedFindCell !== cell) {
		const previous = autoExpandedFindCell;
		autoExpandedFindCell = undefined;
		if (!isInputCollapsed(previous)) {
			setInputCollapsed(previous, true, false);
		}
	}

	if (!isInputCollapsed(cell)) {
		return false;
	}

	setInputCollapsed(cell, false, false);
	autoExpandedFindCell = cell;
	return true;
}

function afterCellExpansion(callback: () => void): void {
	requestAnimationFrame(() => requestAnimationFrame(callback));
}

function instrumentFindMatch(cell: NotebookCellModel, match: NotebookEditorFindMatch): NotebookEditorFindMatch {
	const matchObject = match as object;
	if (instrumentedFindMatches.has(matchObject)) {
		return match;
	}
	instrumentedFindMatches.add(matchObject);

	const originalShow = match.show.bind(match);
	match.show = () => {
		const expandedForFind = prepareFindJump(cell);
		if (expandedForFind) {
			afterCellExpansion(originalShow);
		} else {
			originalShow();
		}
	};
	return match;
}

function revealCollapsedSourceMatch(
	cell: NotebookCellModel,
	options: NotebookEditorFindMatchOptions,
	index: number,
	originalFindMatches: (this: NotebookCellModel, options: NotebookEditorFindMatchOptions) => NotebookEditorFindMatch[]
): void {
	prepareFindJump(cell);

	const reveal = () => {
		afterCellExpansion(() => {
			const matches = originalFindMatches.call(cell, options);
			const match = matches[index] ?? matches[0];
			if (match) {
				match.selected = true;
				match.show();
			} else if (cell.cellKind === CellKind.Code) {
				cell.requestCenterEditor();
			}
		});
	};

	if (cell.cellKind === CellKind.Code) {
		void cell.resolveTextModel().then(reveal);
	} else {
		reveal();
	}
}

let findPatched = false;

function patchNotebookFindForCollapsedCells(): void {
	if (findPatched) {
		return;
	}
	findPatched = true;

	const originalFindMatches = NotebookCellModel.prototype.findMatches;
	NotebookCellModel.prototype.findMatches = function (
		this: NotebookCellModel,
		options: NotebookEditorFindMatchOptions
	): NotebookEditorFindMatch[] {
		if (isInputCollapsed(this) && this.cellKind === CellKind.Markup) {
			const count = countCollapsedSourceMatches(this, options);
			return Array.from({ length: count }, (_, index): NotebookEditorFindMatch => ({
				selected: false,
				show: () => revealCollapsedSourceMatch(this, options, index, originalFindMatches)
			}));
		}

		const matches = originalFindMatches.call(this, options);
		if (matches.length > 0 || !isInputCollapsed(this)) {
			return matches.map(match => instrumentFindMatch(this, match));
		}

		const count = countCollapsedSourceMatches(this, options);
		return Array.from({ length: count }, (_, index): NotebookEditorFindMatch => ({
			selected: false,
			show: () => revealCollapsedSourceMatch(this, options, index, originalFindMatches)
		}));
	};
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
		const expanded = this.props.renderExpanded();
		if (!React.isValidElement<{ children?: React.ReactNode; onMouseDown?: React.MouseEventHandler<HTMLElement> }>(expanded)) {
			return expanded;
		}

		const outerChildren = React.Children.toArray(expanded.props.children);
		if (outerChildren.length !== 1 || !React.isValidElement<{ children?: React.ReactNode }>(outerChildren[0])) {
			return expanded;
		}

		const editorContainer = outerChildren[0];
		const editorChildren = React.Children.toArray(editorContainer.props.children);
		if (editorChildren.length < 2) {
			return expanded;
		}

		const [editor, ...persistentChildren] = editorChildren;
		return React.cloneElement(
			expanded,
			{
				onMouseDown: event => {
					expanded.props.onMouseDown?.(event);
					finishAutoExpandedFindCell(this.props.cell);
				}
			},
			React.cloneElement(
				editorContainer,
				{},
				this.state.collapsed ? this.renderCollapsedInput() : editor,
				...persistentChildren
			)
		);
	}

	protected renderCollapsedInput(): React.ReactNode {
		return React.createElement(
			'div',
			{
				title: 'Double-click to Expand Cell Input',
				onDoubleClick: () => setInputCollapsed(this.props.cell, false),
				style: {
					alignItems: 'center',
					cursor: 'default',
					display: 'flex',
					minHeight: '24px',
					opacity: 0.7,
					padding: '0 10px'
				}
			},
			React.createElement('span', {
				className: codicon('chevron-right'),
				onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
					event.stopPropagation();
					setInputCollapsed(this.props.cell, false);
				},
				style: { cursor: 'pointer', marginRight: '6px' },
				title: 'Expand Cell Input'
			}),
			React.createElement('span', undefined, 'Cell input is collapsed')
		);
	}
}

class CollapsibleMarkdownCellInput extends React.Component<CollapsibleCodeCellInputProps, CollapsibleCodeCellInputState> {
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
			const expanded = this.props.renderExpanded();
			if (!React.isValidElement<{ onMouseDown?: React.MouseEventHandler<HTMLElement> }>(expanded)) {
				return expanded;
			}
			return React.cloneElement(expanded, {
				onMouseDown: event => {
					expanded.props.onMouseDown?.(event);
					finishAutoExpandedFindCell(this.props.cell);
				}
			});
		}

		const preview = this.props.cell.source.replace(/\s+/g, ' ').trim() || 'Empty markdown cell';
		return React.createElement(
			'div',
			{
				className: 'theia-notebook-markdown-content',
				title: 'Double-click to Expand Cell Input',
				onDoubleClick: () => setInputCollapsed(this.props.cell, false),
				ref: (node: HTMLDivElement | null) => observeCellHeight(node, this.props.cell),
				style: {
					alignItems: 'center',
					cursor: 'default',
					display: 'flex',
					minHeight: '24px',
					opacity: 0.7,
					overflow: 'hidden',
					padding: '0 10px'
				}
			},
			React.createElement('span', {
				className: codicon('chevron-right'),
				onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
					event.stopPropagation();
					setInputCollapsed(this.props.cell, false);
				},
				style: { cursor: 'pointer', flexShrink: 0, marginRight: '6px' },
				title: 'Expand Cell Input'
			}),
			React.createElement('span', {
				style: {
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap'
				}
			}, preview)
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

const codeFoldingEnabledCells = new WeakSet<NotebookCellModel>();
let rendererPatched = false;

function enableCodeFolding(cell: NotebookCellModel): void {
	if (codeFoldingEnabledCells.has(cell)) {
		return;
	}
	codeFoldingEnabledCells.add(cell);

	cell.editorOptions = {
		...cell.editorOptions,
		folding: true,
		showFoldingControls: 'always'
	};
}

export function patchNotebookCodeCellInputCollapse(): void {
	patchNotebookFindForCollapsedCells();
	if (rendererPatched) {
		return;
	}
	rendererPatched = true;

	const originalRender = NotebookCodeCellRenderer.prototype.render;
	const originalMarkdownRender = NotebookMarkdownCellRenderer.prototype.render;
	NotebookCodeCellRenderer.prototype.render = function (
		this: NotebookCodeCellRenderer,
		notebookModel: NotebookModel,
		cell: NotebookCellModel,
		handle: number
	): React.ReactNode {
		trackNotebook(notebookModel);
		notebookByCell.set(cell, notebookModel);
		enableCodeFolding(cell);
		return React.createElement(CollapsibleCodeCellInput, {
			cell,
			renderExpanded: () => originalRender.call(this, notebookModel, cell, handle)
		});
	};

	NotebookMarkdownCellRenderer.prototype.render = function (
		this: NotebookMarkdownCellRenderer,
		notebookModel: NotebookModel,
		cell: NotebookCellModel
	): React.ReactNode {
		trackNotebook(notebookModel);
		notebookByCell.set(cell, notebookModel);
		return React.createElement(CollapsibleMarkdownCellInput, {
			cell,
			renderExpanded: () => originalMarkdownRender.call(this, notebookModel, cell)
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

	export const COLLAPSE_ALL_INPUTS: Command = {
		id: 'notebook.cell.collapseAllCellInputs',
		label: 'Collapse All Cell Inputs',
		category: 'Notebook'
	};

	export const EXPAND_ALL_INPUTS: Command = {
		id: 'notebook.cell.expandAllCellInputs',
		label: 'Expand All Cell Inputs',
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

	@inject(CommandRegistry)
	protected readonly commandRegistry!: CommandRegistry;

	@postConstruct()
	protected init(): void {
		initializeInputCollapsePersistence(this.storageService, this.notebookEditorWidgetService);
		document.addEventListener('keydown', this.handleNotebookEditorKeyDown, true);
	}

	protected readonly handleNotebookEditorKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing) {
			return;
		}

		const editor = this.notebookEditorWidgetService.focusedEditor;
		const notebook = editor?.model;
		const target = event.target;
		if (!editor || !notebook || !(target instanceof Element) || !editor.node.contains(target)) {
			return;
		}
		if (!target.closest('.theia-notebook-cell-editor')) {
			return;
		}

		const cellNode = target.closest<HTMLElement>('.theia-notebook-cell[data-cell-handle]');
		if (!cellNode || !editor.node.contains(cellNode)) {
			return;
		}

		const handle = Number(cellNode.dataset.cellHandle);
		if (!Number.isInteger(handle)) {
			return;
		}
		const cell = notebook.getCellByHandle(handle);
		if (cell?.cellKind !== CellKind.Code) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		void this.commandRegistry.executeCommand(NotebookCellCommands.EXECUTE_SINGLE_CELL_COMMAND.id, notebook, cell);
	};

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(NotebookCellInputCollapseCommands.COLLAPSE, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell) && !isInputCollapsed(cell);
			},
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell) && !isInputCollapsed(cell);
			},
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell && isInputCollapsibleCell(cell)) {
					setInputCollapsed(cell, true);
				}
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.EXPAND, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell) && isInputCollapsed(cell);
			},
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell) && isInputCollapsed(cell);
			},
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell && isInputCollapsibleCell(cell)) {
					setInputCollapsed(cell, false);
				}
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.TOGGLE, {
			isEnabled: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell);
			},
			isVisible: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				return !!cell && isInputCollapsibleCell(cell);
			},
			execute: (first?: NotebookModel | NotebookCellModel, second?: NotebookCellModel) => {
				const cell = this.resolveCell(first, second);
				if (cell && isInputCollapsibleCell(cell)) {
					setInputCollapsed(cell, !isInputCollapsed(cell));
				}
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.COLLAPSE_ALL_INPUTS, {
			isEnabled: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				return !!notebook?.cells.some(cell => isInputCollapsibleCell(cell) && !isInputCollapsed(cell));
			},
			isVisible: (item?: URI | NotebookModel) => !!this.resolveNotebook(item),
			execute: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				if (!notebook) {
					return;
				}

				trackNotebook(notebook);
				for (const cell of notebook.cells) {
					if (isInputCollapsibleCell(cell)) {
						setInputCollapsed(cell, true, false);
					}
				}
				void inputCollapseStorageReady.then(() => persistNotebookInputCollapseState(notebook));
			}
		});

		commands.registerCommand(NotebookCellInputCollapseCommands.EXPAND_ALL_INPUTS, {
			isEnabled: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				return !!notebook?.cells.some(cell => isInputCollapsibleCell(cell) && isInputCollapsed(cell));
			},
			isVisible: (item?: URI | NotebookModel) => !!this.resolveNotebook(item),
			execute: (item?: URI | NotebookModel) => {
				const notebook = this.resolveNotebook(item);
				if (!notebook) {
					return;
				}

				trackNotebook(notebook);
				for (const cell of notebook.cells) {
					if (isInputCollapsibleCell(cell)) {
						setInputCollapsed(cell, false, false);
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
			commandId: NotebookCellInputCollapseCommands.COLLAPSE_ALL_INPUTS.id,
			label: 'Collapse All Cell Inputs',
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
