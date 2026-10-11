import { ContainerModule } from '@theia/core/shared/inversify';
import { WindowStateMain } from '@theia/plugin-ext/lib/main/browser/window-state-main';

type FocusChangedHandler = (this: WindowStateMain, focused: boolean) => void;
type FocusMonitor = {
	interval?: ReturnType<typeof setInterval>;
	timeout?: ReturnType<typeof setTimeout>;
	lastFocused: boolean;
};

// `onFocusChanged` is private upstream, so it is reached through the untyped prototype.
const prototype = WindowStateMain.prototype as unknown as { onFocusChanged?: FocusChangedHandler };
const originalOnFocusChanged = prototype.onFocusChanged;

if (typeof originalOnFocusChanged !== 'function') {
	throw new Error('Unsupported Theia WindowStateMain: onFocusChanged was not found');
}

const onFocusChanged: FocusChangedHandler = originalOnFocusChanged;

const monitors = new WeakMap<WindowStateMain, FocusMonitor>();

function clearFocusMonitor(instance: WindowStateMain): void {
	const monitor = monitors.get(instance);
	if (monitor == null) return;

	if (monitor.timeout != null) {
		clearTimeout(monitor.timeout);
	}
	if (monitor.interval != null) {
		clearInterval(monitor.interval);
	}
	monitors.delete(instance);
}

function startFocusMonitor(instance: WindowStateMain): void {
	clearFocusMonitor(instance);

	const monitor: FocusMonitor = { lastFocused: true };
	monitors.set(instance, monitor);

	// Let the browser finish transferring focus before deciding whether the whole IDE lost focus.
	monitor.timeout = setTimeout(() => {
		monitor.timeout = undefined;

		const reportCurrentFocus = () => {
			const focused = document.hasFocus();
			if (focused === monitor.lastFocused) return;

			monitor.lastFocused = focused;
			onFocusChanged.call(instance, focused);
		};

		reportCurrentFocus();
		// The top window may receive no further focus or blur events while a child iframe owns focus.
		// Poll until normal top level focus returns so app switches are still reported correctly.
		monitor.interval = setInterval(reportCurrentFocus, 50);
	});
}

export default new ContainerModule(() => {
	prototype.onFocusChanged = function (focused) {
		if (focused) {
			clearFocusMonitor(this);
			onFocusChanged.call(this, true);
			return;
		}

		startFocusMonitor(this);
	};
});
