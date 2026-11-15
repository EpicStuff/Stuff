import { CellOutputWebviewImpl } from '@theia/plugin-ext/lib/main/browser/notebooks/renderers/cell-output-webview';

interface CellOutputWebviewPrototype {
	preloadsScriptString(isWorkspaceTrusted: boolean): string;
}

let outputSelectAllPatched = false;

export function patchNotebookOutputSelectAll(): void {
	if (outputSelectAllPatched) {
		return;
	}
	outputSelectAllPatched = true;

	const prototype = CellOutputWebviewImpl.prototype as unknown as CellOutputWebviewPrototype;
	const originalPreloadsScriptString = prototype.preloadsScriptString;
	prototype.preloadsScriptString = function (this: CellOutputWebviewPrototype, isWorkspaceTrusted: boolean): string {
		const original = originalPreloadsScriptString.call(this, isWorkspaceTrusted);
		return `${original}
;(() => {
	let lastFocusedOutput;

	const getOutputContainer = event => {
		for (const node of event.composedPath()) {
			if (node instanceof HTMLElement && node.classList.contains('output')) {
				return node;
			}
		}
		return undefined;
	};

	const hasActiveEditableElement = (parent, root = document) => {
		const element = root.activeElement;
		return !!(element && parent.contains(element) && (element.matches(':read-write') || element.tagName.toLowerCase() === 'select' || (element.shadowRoot && hasActiveEditableElement(element.shadowRoot, element.shadowRoot))));
	};

	document.addEventListener('click', event => {
		lastFocusedOutput = getOutputContainer(event);
	}, true);

	document.addEventListener('focusin', event => {
		const output = getOutputContainer(event);
		if (output) {
			lastFocusedOutput = output;
		}
	}, true);

	document.addEventListener('keydown', event => {
		if (!lastFocusedOutput || !((event.key === 'a' && event.ctrlKey) || (event.metaKey && event.key === 'a'))) {
			return;
		}

		const activeElement = document.activeElement;
		if (activeElement && hasActiveEditableElement(activeElement, document)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const selection = window.getSelection();
		if (!selection || !document.contains(lastFocusedOutput)) {
			return;
		}

		selection.removeAllRanges();
		const range = document.createRange();
		range.selectNode(lastFocusedOutput);
		selection.addRange(range);
	}, true);
})();`;
	};
}
