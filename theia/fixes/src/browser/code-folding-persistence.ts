import { FrontendApplicationContribution, StorageService } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { FOLDING_CONTRIBUTION_ID, FoldingState, mergeFoldingIntoViewState, readFoldingFromViewState, sanitizeStoredFoldingStates, StoredFoldingStates } from './folding-state';

const STORAGE_KEY = 'theia-fixes.source-folding.v1';
const SAVE_DELAY_MS = 250;

interface FoldingController {
	dispose(): void;
	getFoldingModel(): Promise<unknown> | null;
}

@injectable()
export class CodeFoldingPersistenceContribution implements FrontendApplicationContribution {
	@inject(EditorManager)
	protected readonly editorManager!: EditorManager;

	@inject(StorageService)
	protected readonly storageService!: StorageService;

	private states: StoredFoldingStates = Object.create(null) as StoredFoldingStates;
	private readonly tracked = new Map<EditorWidget, () => void>();
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private pendingWrite: Promise<void> = Promise.resolve();

	async onStart(): Promise<void> {
		// Subscribe first, so editors created while storage is loading are not missed.
		const ready = this.storageService.getData<StoredFoldingStates>(STORAGE_KEY, {}).then(saved => {
			this.states = sanitizeStoredFoldingStates(saved);
		});
		this.editorManager.onCreated(widget => {
			void ready.then(() => this.track(widget));
		});
		await ready;
		for (const widget of this.editorManager.all) {
			this.track(widget);
		}
	}

	async onStop(): Promise<void> {
		for (const capture of this.tracked.values()) {
			capture();
		}
		await this.flush();
	}

	private track(widget: EditorWidget): void {
		if (widget.isDisposed || this.tracked.has(widget) || !(widget.editor instanceof MonacoEditor)) {
			return;
		}

		const editor = widget.editor;
		if (editor.uri.scheme !== 'file') {
			return;
		}

		const uri = editor.uri.toString();
		const control = editor.getControl();
		const disposables = new DisposableCollection();
		let restoring = false;
		let ready = false;
		let disposed = false;

		const capture = (): void => {
			if (!ready || disposed) {
				return;
			}
			// Theia removes the Monaco model while an editor tab is hidden.
			// MonacoEditor.storeViewState still returns its saved view state.
			const viewState = control.getModel() ? control.saveViewState() : editor.storeViewState();
			const state = readFoldingFromViewState(viewState);
			if (!state) {
				return;
			}
			if (state.collapsedRegions?.length) {
				this.states[uri] = state;
			} else {
				delete this.states[uri];
			}
			this.scheduleSave();
		};

		const restore = async (): Promise<void> => {
			if (ready || restoring || disposed || !control.getModel()) {
				return;
			}
			restoring = true;
			const initialModel = control.getModel();
			const saved = this.states[uri];
			try {
				if (saved) {
					// Monaco computes folding ranges asynchronously. Applying a memento
					// before that computation finishes can lose the restored folds.
					const controller = control.getContribution<FoldingController>(FOLDING_CONTRIBUTION_ID);
					await controller?.getFoldingModel();

					if (disposed || control.getModel() !== initialModel) {
						return;
					}
					const current = control.saveViewState();
					if (current) {
						control.restoreViewState(mergeFoldingIntoViewState(current, saved));
					}
				}
				ready = true;
			} catch (error) {
				console.warn('Unable to restore source code folds:', error);
				ready = true;
			} finally {
				restoring = false;
			}
		};

		disposables.push(control.onDidChangeHiddenAreas(capture));
		disposables.push(control.onDidChangeModel(() => {
			if (!ready) {
				void restore();
			}
		}));
		disposables.push(widget.onDidChangeVisibility(() => {
			if (!ready) {
				queueMicrotask(() => { void restore(); });
			}
		}));
		disposables.push(widget.onDispose(() => {
			capture();
			disposed = true;
			disposables.dispose();
			this.tracked.delete(widget);
		}));

		this.tracked.set(widget, capture);
		void restore();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) {
			clearTimeout(this.saveTimer);
		}
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.flush().catch(error => console.error('Unable to persist source code folds:', error));
		}, SAVE_DELAY_MS);
	}

	private flush(): Promise<void> {
		if (this.saveTimer !== undefined) {
			clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		const snapshot = { ...this.states };
		// Serialize writes so an older write cannot replace a more recent one.
		this.pendingWrite = this.pendingWrite.catch(error => {
			console.error('Unable to persist source code folds:', error);
		}).then(() => this.storageService.setData(STORAGE_KEY, snapshot));
		return this.pendingWrite;
	}
}
