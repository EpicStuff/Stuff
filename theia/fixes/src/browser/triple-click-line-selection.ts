import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import { ICodeEditor } from '@theia/monaco-editor-core/esm/vs/editor/browser/editorBrowser';
import { ICodeEditorService } from '@theia/monaco-editor-core/esm/vs/editor/browser/services/codeEditorService';
import { StandaloneServices } from '@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices';
import { listenForTripleClickSelection } from './triple-click-selection';

@injectable()
export class TripleClickLineSelectionContribution implements FrontendApplicationContribution {
	private readonly codeEditorService = StandaloneServices.get(ICodeEditorService);
	private readonly subscriptions = new DisposableCollection();
	private readonly tracked = new Map<ICodeEditor, { dispose(): void }>();

	onStart(): void {
		this.subscriptions.push(this.codeEditorService.onCodeEditorAdd(editor => this.track(editor)));
		this.subscriptions.push(this.codeEditorService.onCodeEditorRemove(editor => this.untrack(editor)));
		for (const editor of this.codeEditorService.listCodeEditors()) {
			this.track(editor);
		}
	}

	onStop(): void {
		this.subscriptions.dispose();
		for (const subscription of this.tracked.values()) {
			subscription.dispose();
		}
		this.tracked.clear();
	}

	private track(editor: ICodeEditor): void {
		if (!this.tracked.has(editor)) {
			this.tracked.set(editor, listenForTripleClickSelection(editor));
		}
	}

	private untrack(editor: ICodeEditor): void {
		this.tracked.get(editor)?.dispose();
		this.tracked.delete(editor);
	}
}
