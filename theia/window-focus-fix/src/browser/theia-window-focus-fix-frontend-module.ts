import { ContainerModule } from '@theia/core/shared/inversify';
import { WindowStateMain } from '@theia/plugin-ext/lib/main/browser/window-state-main';

type FocusChangedHandler = (this: WindowStateMain, focused: boolean) => void;

// `onFocusChanged` is private upstream, so it is reached through the untyped prototype.
const prototype = WindowStateMain.prototype as unknown as { onFocusChanged: FocusChangedHandler };
const onFocusChanged = prototype.onFocusChanged;

export default new ContainerModule(() => {
	prototype.onFocusChanged = function (focused) {
		if (focused) {
			onFocusChanged.call(this, true);
			return;
		}

		// Moving focus into a webview iframe blurs the top window although the IDE window keeps focus.
		// `document.hasFocus()` stays true while a child frame holds focus, and focus settles after the event.
		setTimeout(() => {
			if (!document.hasFocus()) {
				onFocusChanged.call(this, false);
			}
		});
	};
});
