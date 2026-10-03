import { Disposable, DisposableCollection } from '@theia/core';
import { NotebookContextManager } from '@theia/notebook/lib/browser/service/notebook-context-manager';
import { NotebookKernelService } from '@theia/notebook/lib/browser/service/notebook-kernel-service';
import {
	NOTEBOOK_CELL_INPUT_COLLAPSED,
	NOTEBOOK_CELL_OUTPUT_COLLAPSED,
	NOTEBOOK_CELL_RESOURCE,
	NOTEBOOK_INTERRUPTIBLE_KERNEL,
	NOTEBOOK_KERNEL_COUNT
} from '@theia/notebook/lib/browser/contributions/notebook-context-keys';
import { NotebookEditorWidget } from '@theia/notebook/lib/browser/notebook-editor-widget';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';

interface NotebookContextManagerAccess {
	notebookKernelService: NotebookKernelService;
	scopedStore: {
		setContext(key: string, value: unknown): void;
	};
	setCellContext(cellHandle: number, key: string, value: unknown): void;
	toDispose: DisposableCollection;
}

const notebookModels = new WeakMap<NotebookContextManager, NotebookModel>();
const selectedKernelSubscriptions = new WeakMap<NotebookContextManager, DisposableCollection>();

function access(manager: NotebookContextManager): NotebookContextManagerAccess {
	return manager as unknown as NotebookContextManagerAccess;
}

function updateKernelContext(manager: NotebookContextManager, notebook: NotebookModel): void {
	const managerAccess = access(manager);
	const { all, selected } = managerAccess.notebookKernelService.getMatchingKernel(notebook);

	managerAccess.scopedStore.setContext(NOTEBOOK_KERNEL_COUNT, all.length);
	managerAccess.scopedStore.setContext(NOTEBOOK_INTERRUPTIBLE_KERNEL, selected?.implementsInterrupt ?? false);

	const previousSubscription = selectedKernelSubscriptions.get(manager);
	previousSubscription?.dispose();

	const subscription = new DisposableCollection();
	selectedKernelSubscriptions.set(manager, subscription);
	if (selected) {
		subscription.push(selected.onDidChange(event => {
			if (event.hasInterruptHandler) {
				managerAccess.scopedStore.setContext(NOTEBOOK_INTERRUPTIBLE_KERNEL, selected.implementsInterrupt ?? false);
			}
		}));
	}
}

let notebookContextPatched = false;

export function patchNotebookContextCompatibility(): void {
	if (notebookContextPatched) {
		return;
	}
	notebookContextPatched = true;

	const originalInit = NotebookContextManager.prototype.init;
	NotebookContextManager.prototype.init = function (this: NotebookContextManager, widget: NotebookEditorWidget): void {
		originalInit.call(this, widget);

		const notebook = widget.model;
		if (!notebook) {
			return;
		}

		notebookModels.set(this, notebook);
		const managerAccess = access(this);
		const update = () => updateKernelContext(this, notebook);
		update();

		managerAccess.toDispose.push(managerAccess.notebookKernelService.onDidAddKernel(update));
		managerAccess.toDispose.push(managerAccess.notebookKernelService.onDidRemoveKernel(update));
		managerAccess.toDispose.push(managerAccess.notebookKernelService.onDidChangeNotebookAffinity(update));
		managerAccess.toDispose.push(managerAccess.notebookKernelService.onDidChangeSelectedKernel(event => {
			if (event.notebook.toString() === notebook.uri.toString()) {
				update();
			}
		}));
		managerAccess.toDispose.push(Disposable.create(() => {
			selectedKernelSubscriptions.get(this)?.dispose();
			selectedKernelSubscriptions.delete(this);
			notebookModels.delete(this);
		}));
	};

	const originalGetCellContext = NotebookContextManager.prototype.getCellContext;
	NotebookContextManager.prototype.getCellContext = function (this: NotebookContextManager, cellHandle: number) {
		const notebook = notebookModels.get(this);
		const cell = notebook?.getCellByHandle(cellHandle);
		if (cell) {
			const managerAccess = access(this);
			managerAccess.setCellContext(cellHandle, NOTEBOOK_CELL_RESOURCE, cell.uri.toString());
			managerAccess.setCellContext(cellHandle, NOTEBOOK_CELL_INPUT_COLLAPSED, isNotebookCellInputCollapsed(cell));
			managerAccess.setCellContext(cellHandle, NOTEBOOK_CELL_OUTPUT_COLLAPSED, !cell.outputVisible);
		}
		return originalGetCellContext.call(this, cellHandle);
	};
}

type NotebookCellWithInputCollapse = Parameters<NotebookContextManagerAccess['setCellContext']>[0] extends never ? never : {
	getData(): {
		collapseState?: {
			inputCollapsed?: boolean;
		};
	};
};

let inputCollapseStateReader: ((cell: NotebookCellWithInputCollapse) => boolean) | undefined;

export function setNotebookCellInputCollapseStateReader(reader: (cell: NotebookCellWithInputCollapse) => boolean): void {
	inputCollapseStateReader = reader;
}

function isNotebookCellInputCollapsed(cell: NotebookCellWithInputCollapse): boolean {
	return inputCollapseStateReader?.(cell) ?? cell.getData().collapseState?.inputCollapsed ?? false;
}
