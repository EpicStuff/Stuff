export interface AttentiveWindow {
	isDestroyed(): boolean;
	isMinimized(): boolean;
	isVisible(): boolean;
	isFocused(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
	flashFrame(flag: boolean): void;
	once(event: 'focus' | 'closed', listener: () => void): unknown;
}

const awaitingFocus = new WeakSet<AttentiveWindow>();

export function revealEditorWindow(window: AttentiveWindow): void {
	if (window.isDestroyed()) {
		return;
	}
	if (window.isMinimized()) {
		window.restore();
	}
	if (!window.isVisible()) {
		window.show();
	}
	window.focus();

	if (!window.isFocused() && !awaitingFocus.has(window)) {
		awaitingFocus.add(window);
		window.once('focus', () => {
			awaitingFocus.delete(window);
			if (!window.isDestroyed()) {
				window.flashFrame(false);
			}
		});
		window.once('closed', () => awaitingFocus.delete(window));
		window.flashFrame(true);
	}
}
