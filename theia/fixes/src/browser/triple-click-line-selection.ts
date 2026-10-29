import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoDiffEditor } from '@theia/monaco/lib/browser/monaco-diff-editor';
import { getTripleClickControls, getTripleClickSelection } from './triple-click-selection';

@injectable()
export class TripleClickLineSelectionContribution implements FrontendApplicationContribution {
	@inject(EditorManager)
	protected readonly editorManager!: EditorManager;

	private readonly toDispose = new DisposableCollection();
	private readonly tracked = new Map<EditorWidget, DisposableCollection>();

	onStart(): void {
		this.toDispose.push(this.editorManager.onCreated(widget => this.track(widget)));
		for (const widget of this.editorManager.all) {
			this.track(widget);
		}
	}

	onStop(): void {
		this.toDispose.dispose();
		for (const subscriptions of this.tracked.values()) {
			subscriptions.dispose();
		}
		this.tracked.clear();
	}

	private track(widget: EditorWidget): void {
		if (widget.isDisposed || this.tracked.has(widget) || !(widget.editor instanceof MonacoEditor)) {
			return;
		}

		// getControl() refers only to the modified (right) side of a diff.
		// Subscribe to the original editor separately so both sides behave alike.
		const modified = widget.editor.getControl();
		const original = widget.editor instanceof MonacoDiffEditor ? widget.editor.diffEditor.getOriginalEditor() : undefined;
		const subscriptions = new DisposableCollection();
		for (const control of getTripleClickControls(modified, original)) {
			subscriptions.push(control.onMouseDown(event => {
			const mouse = event.event;
			if (mouse.detail !== 3 || !mouse.leftButton || mouse.altKey || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) {
				return;
			}

			const lineNumber = event.target.position?.lineNumber;
			const model = control.getModel();
			if (!lineNumber || !model) {
				return;
			}

			// Monaco handles the click before emitting onMouseDown, so only adjust
			// its existing full line selection instead of overriding other gestures.
			const selection = getTripleClickSelection(mouse.detail, lineNumber, model.getLineMaxColumn(lineNumber), control.getSelection());
			if (selection) {
				control.setSelection(selection);
			}
			}));
		}
		subscriptions.push(widget.onDispose(() => {
			subscriptions.dispose();
			this.tracked.delete(widget);
		}));
		this.tracked.set(widget, subscriptions);
	}
}
