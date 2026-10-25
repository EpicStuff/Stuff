import { DisposableCollection } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import { EditorCommands } from '@theia/editor/lib/browser/editor-command';
import { EditorNavigationContribution } from '@theia/editor/lib/browser/editor-navigation-contribution';
import { EditorOption } from '@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions';
import { ITextModel } from '@theia/monaco-editor-core/esm/vs/editor/common/model';
import { ICodeEditor, IDiffEditor } from '@theia/monaco-editor-core/esm/vs/editor/browser/editorBrowser';
import { ICodeEditorService } from '@theia/monaco-editor-core/esm/vs/editor/browser/services/codeEditorService';
import { StandaloneServices } from '@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices';
import { nextWordWrapOverride, syncedDiffWordWrapOverride, WordWrapOverride } from './word-wrap-state';

const WORD_WRAP_STATE_KEY = 'theia-fixes.transientWordWrapState';

/** Match VS Code's temporary model-scoped word wrap toggle. */
@injectable()
export class VSCodeWordWrapNavigationContribution extends EditorNavigationContribution {
	private readonly codeEditorService = StandaloneServices.get(ICodeEditorService);
	private readonly subscriptions = new DisposableCollection();
	private readonly tracked = new Map<ICodeEditor, DisposableCollection>();
	private readonly trackedDiffs = new Map<IDiffEditor, DisposableCollection>();
	private readonly applied = new WeakSet<ICodeEditor>();

	protected override init(): void {
		super.init();
		// Modify the handler just registered by super.init rather than adding another.
		// Theia falls back to older handlers if a new handler is disabled.
		const handler = this.commandRegistry.getAllHandlers(EditorCommands.TOGGLE_WORD_WRAP.id)[0];
		if (!handler) {
			throw new Error('Theia did not register the Toggle Word Wrap command');
		}
		handler.isEnabled = () => this.canToggle(this.getActiveEditor());
		handler.isToggled = () => {
			const editor = this.getActiveEditor();
			return this.canToggle(editor) && editor.getOption(EditorOption.wrappingInfo).wrappingColumn !== -1;
		};
	}

	override onStart(): Promise<void> {
		this.subscriptions.push(this.codeEditorService.onCodeEditorAdd(editor => this.trackEditor(editor)));
		this.subscriptions.push(this.codeEditorService.onCodeEditorRemove(editor => this.untrackEditor(editor)));
		this.subscriptions.push(this.codeEditorService.onDiffEditorAdd(diff => this.trackDiff(diff)));
		this.subscriptions.push(this.codeEditorService.onDiffEditorRemove(diff => this.untrackDiff(diff)));
		this.subscriptions.push(this.codeEditorService.onDidChangeTransientModelProperty(model => this.applyToModel(model)));
		for (const editor of this.codeEditorService.listCodeEditors()) {
			this.trackEditor(editor);
		}
		for (const diff of this.codeEditorService.listDiffEditors()) {
			this.trackDiff(diff);
		}
		return super.onStart();
	}

	override onStop(): void {
		this.subscriptions.dispose();
		for (const subscriptions of this.tracked.values()) {
			subscriptions.dispose();
		}
		for (const subscriptions of this.trackedDiffs.values()) {
			subscriptions.dispose();
		}
		this.tracked.clear();
		this.trackedDiffs.clear();
		super.onStop();
	}

	protected override async toggleWordWrap(): Promise<void> {
		const editor = this.getActiveEditor();
		if (!this.canToggle(editor)) {
			return;
		}
		const model = editor.getModel()!;
		const wrapped = editor.getOption(EditorOption.wrappingInfo).wrappingColumn !== -1;
		const override = nextWordWrapOverride(this.readState(model), wrapped);
		this.writeState(model, override);
		// Apply the same temporary override to the other side of a diff editor.
		const diff = this.codeEditorService.listDiffEditors().find(candidate => candidate.getOriginalEditor() === editor || candidate.getModifiedEditor() === editor);
		if (diff) {
			const other = diff.getOriginalEditor() === editor ? diff.getModifiedEditor() : diff.getOriginalEditor();
			if (this.canToggle(other)) {
				this.writeState(other.getModel()!, override);
				diff.updateOptions({});
			}
		}
	}

	private getActiveEditor(): ICodeEditor | null {
		return this.codeEditorService.getFocusedCodeEditor() ?? this.codeEditorService.getActiveCodeEditor();
	}

	private canToggle(editor: ICodeEditor | null): editor is ICodeEditor {
		if (!editor || editor.isSimpleWidget || !editor.getModel()) {
			return false;
		}
		if (editor.getOption(EditorOption.inDiffEditor)) {
			for (const diff of this.codeEditorService.listDiffEditors()) {
				if (diff.getOriginalEditor() === editor && !diff.renderSideBySide) {
					return false;
				}
			}
		}
		return true;
	}

	private readState(model: ITextModel | null): WordWrapOverride {
		if (!model) {
			return 'inherit';
		}
		const state = this.codeEditorService.getTransientModelProperty(model, WORD_WRAP_STATE_KEY);
		return state === 'on' || state === 'off' ? state : 'inherit';
	}

	private writeState(model: ITextModel, override: WordWrapOverride): void {
		this.codeEditorService.setTransientModelProperty(model, WORD_WRAP_STATE_KEY, override === 'inherit' ? null : override);
		this.applyToModel(model);
	}

	private trackEditor(editor: ICodeEditor): void {
		if (this.tracked.has(editor)) {
			return;
		}
		const subscriptions = new DisposableCollection();
		let applying = false;
		const apply = (): void => {
			if (applying) {
				return;
			}
			applying = true;
			try {
				this.applyState(editor);
			} finally {
				applying = false;
			}
		};
		subscriptions.push(editor.onDidChangeModel(apply));
		subscriptions.push(editor.onDidChangeConfiguration(event => {
			if (event.hasChanged(EditorOption.wrappingInfo) || event.hasChanged(EditorOption.wordWrapOverride2)) {
				apply();
			}
		}));
		this.tracked.set(editor, subscriptions);
		apply();
	}

	private untrackEditor(editor: ICodeEditor): void {
		this.tracked.get(editor)?.dispose();
		this.tracked.delete(editor);
		this.applied.delete(editor);
	}

	private trackDiff(diff: IDiffEditor): void {
		if (this.trackedDiffs.has(diff)) {
			return;
		}
		const subscriptions = new DisposableCollection();
		subscriptions.push(diff.onDidChangeModel(() => this.synchronizeDiff(diff)));
		this.trackedDiffs.set(diff, subscriptions);
		this.synchronizeDiff(diff);
	}

	private untrackDiff(diff: IDiffEditor): void {
		this.trackedDiffs.get(diff)?.dispose();
		this.trackedDiffs.delete(diff);
	}

	private synchronizeDiff(diff: IDiffEditor): void {
		const original = diff.getOriginalEditor();
		const modified = diff.getModifiedEditor();
		const originalModel = original.getModel();
		const modifiedModel = modified.getModel();
		if (!originalModel || !modifiedModel) {
			return;
		}
		const originalState = this.readState(originalModel);
		const modifiedState = this.readState(modifiedModel);
		const shared = syncedDiffWordWrapOverride(originalState, modifiedState);
		if (shared === undefined) {
			return;
		}
		if (originalState === 'inherit' && this.canToggle(original)) {
			this.writeState(originalModel, shared);
		}
		if (modifiedState === 'inherit' && this.canToggle(modified)) {
			this.writeState(modifiedModel, shared);
		}
		diff.updateOptions({});
	}

	private applyToModel(model: ITextModel): void {
		for (const editor of this.tracked.keys()) {
			if (editor.getModel() === model) {
				this.applyState(editor);
			}
		}
	}

	private applyState(editor: ICodeEditor): void {
		if (!this.canToggle(editor)) {
			return;
		}
		const override = this.readState(editor.getModel());
		if (override === 'inherit' && !this.applied.has(editor)) {
			return;
		}
		if (editor.getOption(EditorOption.wordWrapOverride2) !== override) {
			editor.updateOptions({ wordWrapOverride2: override });
		}
		if (override === 'inherit') {
			this.applied.delete(editor);
		} else {
			this.applied.add(editor);
		}
	}
}
