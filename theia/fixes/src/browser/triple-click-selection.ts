import type { ICodeEditor } from '@theia/monaco-editor-core/esm/vs/editor/browser/editorBrowser';

/** A Monaco line selection includes the newline by ending at column 1 of the next line. */
export interface LineSelectionRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export function getTripleClickSelection(clickCount: number, lineNumber: number, lineMaxColumn: number, selection: LineSelectionRange | null): LineSelectionRange | undefined {
	if (clickCount !== 3 || !selection || selection.startLineNumber !== lineNumber || selection.startColumn !== 1 || selection.endLineNumber !== lineNumber + 1 || selection.endColumn !== 1) {
		return undefined;
	}

	return { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: lineMaxColumn };
}


/** Installs the selection adjustment on any Monaco editor, including embedded editors. */
export function listenForTripleClickSelection(control: ICodeEditor): { dispose(): void } {
	return control.onMouseDown(event => {
		const mouse = event.event;
		if (mouse.detail !== 3 || !mouse.leftButton || mouse.altKey || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) {
			return;
		}

		const lineNumber = event.target.position?.lineNumber;
		const model = control.getModel();
		if (!lineNumber || !model) {
			return;
		}

		// Monaco has already performed its native full line selection.
		const selection = getTripleClickSelection(mouse.detail, lineNumber, model.getLineMaxColumn(lineNumber), control.getSelection());
		if (selection) {
			control.setSelection(selection);
		}
	});
}
