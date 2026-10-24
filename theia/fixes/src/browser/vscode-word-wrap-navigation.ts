import { DisposableCollection } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import { EditorNavigationContribution } from '@theia/editor/lib/browser/editor-navigation-contribution';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoDiffEditor } from '@theia/monaco/lib/browser/monaco-diff-editor';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { TransientWordWrapState } from './word-wrap-state';

/** Replace Theia's four-mode persistent toggle with VS Code's transient per-model toggle. */
@injectable()
export class VSCodeWordWrapNavigationContribution extends EditorNavigationContribution {
	private readonly wordWrapState = new TransientWordWrapState();
	private readonly subscriptions = new DisposableCollection();
	private readonly tracked = new Map<EditorWidget, DisposableCollection>();

	override onStart(): Promise<void> {
		this.subscriptions.push(this.editorManager.onCreated(widget => this.track(widget)));
		for (const widget of this.editorManager.all) {
			this.track(widget);
		}
		return super.onStart();
	}

	override onStop(): void {
		this.subscriptions.dispose();
		for (const subscriptions of this.tracked.values()) {
			subscriptions.dispose();
		}
		this.tracked.clear();
		super.onStop();
	}

	protected override async toggleWordWrap(): Promise<void> {
		const editor = MonacoEditor.getCurrent(this.editorManager);
		if (!editor) {
			return;
		}

		const original = editor instanceof MonacoDiffEditor ? editor.diffEditor.getOriginalEditor() : undefined;
		const modified = editor.getControl();
		const control = original?.hasTextFocus() ? original : modified;
		const model = control.getModel();
		if (!model) {
			return;
		}

		const wrapped = control.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn !== -1;
		const override = this.wordWrapState.toggle(model, wrapped);
		this.applyToModel(model);
		this.applyState(control);

		// VS Code applies the same temporary override to both sides of a diff editor.
		if (original) {
			const other = control === original ? modified : original;
			const otherModel = other.getModel();
			if (otherModel && otherModel !== model) {
				this.wordWrapState.set(otherModel, override);
				this.applyToModel(otherModel);
				this.applyState(other);
			}
		}
	}

	private track(widget: EditorWidget): void {
		if (widget.isDisposed || this.tracked.has(widget) || !(widget.editor instanceof MonacoEditor)) {
			return;
		}
		const controls = widget.editor instanceof MonacoDiffEditor
			? [widget.editor.diffEditor.getOriginalEditor(), widget.editor.diffEditor.getModifiedEditor()]
			: [widget.editor.getControl()];
		const subscriptions = new DisposableCollection();
		for (const control of controls) {
			subscriptions.push(control.onDidChangeModel(() => this.applyState(control)));
			this.applyState(control);
		}
		subscriptions.push(widget.onDispose(() => {
			subscriptions.dispose();
			this.tracked.delete(widget);
		}));
		this.tracked.set(widget, subscriptions);
	}

	private applyToModel(model: monaco.editor.ITextModel): void {
		for (const widget of this.tracked.keys()) {
			const controls = widget.editor instanceof MonacoDiffEditor
				? [widget.editor.diffEditor.getOriginalEditor(), widget.editor.diffEditor.getModifiedEditor()]
				: [widget.editor.getControl()];
			for (const control of controls) {
				if (control.getModel() === model) {
					this.applyState(control);
				}
			}
		}
	}

	private applyState(control: monaco.editor.IStandaloneCodeEditor): void {
		control.updateOptions({ wordWrapOverride2: this.wordWrapState.get(control.getModel()) });
	}
}
