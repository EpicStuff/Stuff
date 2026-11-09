export interface CandidateWindow {
	isDestroyed(): boolean;
	isVisible(): boolean;
}

export function selectExistingEditorWindow<T extends CandidateWindow>(activeWindowStack: readonly number[], windows: ReadonlyMap<number, { window: T }>, excludedWindow?: T): T | undefined {
	let hiddenCandidate: T | undefined;
	for (const id of activeWindowStack) {
		const window = windows.get(id)?.window;
		if (!window || window.isDestroyed() || window === excludedWindow) {
			continue;
		}
		if (window.isVisible()) {
			return window;
		}
		hiddenCandidate ??= window;
	}
	return hiddenCandidate;
}
