import { animationFrame, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { NotebookEditorWidget } from '@theia/notebook/lib/browser/notebook-editor-widget';
import { NotebookEditorWidgetService } from '@theia/notebook/lib/browser/service/notebook-editor-widget-service';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';
import { reloadNotebookPreservingInputCollapseState } from './notebook-cell-input-collapse';

const EXTERNAL_CHANGE_RELOAD_DELAY_MS = 100;

interface NotebookScrollPosition {
	editor: NotebookEditorWidget;
	scrollLeft: number;
	scrollTop: number;
}

@injectable()
export class NotebookExternalFileChangeContribution implements FrontendApplicationContribution {
	@inject(FileService)
	protected readonly fileService!: FileService;

	@inject(NotebookEditorWidgetService)
	protected readonly notebookEditorWidgetService!: NotebookEditorWidgetService;

	protected readonly reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

	onStart(): void {
		this.fileService.onDidFilesChange(event => {
			const seen = new Set<NotebookModel>();
			for (const editor of this.notebookEditorWidgetService.getNotebookEditors()) {
				const model = editor.model;
				if (!model || model.dirty || seen.has(model) || !event.contains(model.uri)) {
					continue;
				}
				seen.add(model);
				this.scheduleReload(model);
			}
		});
	}

	protected scheduleReload(model: NotebookModel): void {
		const key = model.uri.toString();
		const existing = this.reloadTimers.get(key);
		if (existing !== undefined) {
			clearTimeout(existing);
		}

		this.reloadTimers.set(key, setTimeout(() => {
			this.reloadTimers.delete(key);
			void this.reloadIfChanged(model);
		}, EXTERNAL_CHANGE_RELOAD_DELAY_MS));
	}

	protected async reloadIfChanged(model: NotebookModel): Promise<void> {
		if (model.dirty || !this.isOpen(model)) {
			return;
		}

		try {
			const [diskContent, modelContent] = await Promise.all([
				this.fileService.readFile(model.uri),
				model.serialize()
			]);

			if (model.dirty || !this.isOpen(model) || diskContent.value.toString() === modelContent.toString()) {
				return;
			}

			const scrollPositions = this.captureScrollPositions(model);
			await reloadNotebookPreservingInputCollapseState(model);
			await this.restoreScrollPositions(scrollPositions);
		} catch (error) {
			console.error('Failed to reload externally changed notebook', error);
		}
	}

	protected captureScrollPositions(model: NotebookModel): NotebookScrollPosition[] {
		return this.notebookEditorWidgetService.getNotebookEditors().flatMap(editor => {
			if (editor.model !== model) {
				return [];
			}

			const scrollContainer = editor.node.querySelector<HTMLElement>('.theia-notebook-scroll-container');
			return scrollContainer ? [{
				editor,
				scrollLeft: scrollContainer.scrollLeft,
				scrollTop: scrollContainer.scrollTop
			}] : [];
		});
	}

	protected async restoreScrollPositions(positions: NotebookScrollPosition[]): Promise<void> {
		await animationFrame();
		await animationFrame();

		for (const { editor, scrollLeft, scrollTop } of positions) {
			const scrollContainer = editor.node.querySelector<HTMLElement>('.theia-notebook-scroll-container');
			if (scrollContainer) {
				scrollContainer.scrollLeft = scrollLeft;
				scrollContainer.scrollTop = scrollTop;
			}
		}
	}

	protected isOpen(model: NotebookModel): boolean {
		return this.notebookEditorWidgetService.getNotebookEditors().some(editor => editor.model === model);
	}
}
