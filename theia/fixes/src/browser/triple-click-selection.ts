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

/** A diff exposes two distinct Monaco code editor mouse event streams. */
export function getTripleClickControls<T>(modified: T, original?: T): T[] {
	return original === undefined || original === modified ? [modified] : [original, modified];
}
