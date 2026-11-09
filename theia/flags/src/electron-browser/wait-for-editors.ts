/**
 * Wait for the requested editor resources rather than individual widget objects.
 * A tab can move or be replaced without ending an editing session.
 */

export interface WaitDisposable {
	dispose(): void;
}

export interface WaitSaveable {
	readonly dirty: boolean;
	onDirtyChanged(listener: () => void): WaitDisposable;
}

export interface WaitEditor {
	readonly resource: string;
	readonly saveable?: WaitSaveable;
}

export interface EditorWaitHost {
	getOpenEditors(): Iterable<WaitEditor>;
	onDidChangeEditors(listener: (editor: WaitEditor) => void): WaitDisposable;
}

export function waitForEditorResourcesClosed(resources: readonly string[], host: EditorWaitHost): Promise<void> {
	const requested = new Set(resources);
	if (requested.size === 0) {
		throw new Error('No editor resources were provided to --wait');
	}

	return new Promise<void>(resolve => {
		const trackedSaveables = new Map<WaitSaveable, WaitDisposable>();
		let checkTimer: ReturnType<typeof setTimeout> | undefined;
		let finished = false;

		const scheduleCheck = (): void => {
			if (finished || checkTimer !== undefined) {
				return;
			}
			// Ignore transient removal during editor moves and replacements.
			checkTimer = setTimeout(() => {
				checkTimer = undefined;
				check();
			}, 0);
		};

		const observe = (editor: WaitEditor): void => {
			if (!requested.has(editor.resource) || !editor.saveable || trackedSaveables.has(editor.saveable)) {
				return;
			}
			trackedSaveables.set(editor.saveable, editor.saveable.onDirtyChanged(scheduleCheck));
		};

		const check = (): void => {
			if (finished) {
				return;
			}
			let stillOpen = false;
			for (const editor of host.getOpenEditors()) {
				if (requested.has(editor.resource)) {
					stillOpen = true;
					observe(editor);
				}
			}
			if (stillOpen || [...trackedSaveables.keys()].some(saveable => saveable.dirty)) {
				return;
			}
			finished = true;
			changeListener.dispose();
			for (const subscription of trackedSaveables.values()) {
				subscription.dispose();
			}
			trackedSaveables.clear();
			resolve();
		};

		const changeListener = host.onDidChangeEditors(editor => {
			observe(editor);
			scheduleCheck();
		});
		// Subscribe before taking the first snapshot, so an editor cannot close
		// between the initial scan and listener registration.
		scheduleCheck();
	});
}
