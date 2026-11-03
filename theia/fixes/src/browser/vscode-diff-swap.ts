import { ApplicationShell, DiffUris, Saveable, SaveableWidget, Widget, codicon } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoDiffEditor } from '@theia/monaco/lib/browser/monaco-diff-editor';
import { swapDiffInputs } from './swap-diff-inputs';

export const SWAP_DIFF_SIDES: Command = {
	id: 'workbench.action.compareEditor.swapSides',
	category: 'Compare',
	label: 'Swap Left and Right Editor Side'
};

/** Use the normal diff opener and the existing editor group rather than manipulating Monaco's models. */
@injectable()
export class VSCodeDiffSwapContribution implements CommandContribution, TabBarToolbarContribution {
	@inject(ApplicationShell)
	protected readonly shell!: ApplicationShell;

	@inject(EditorManager)
	protected readonly editorManager!: EditorManager;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(SWAP_DIFF_SIDES, {
			execute: (widget?: Widget) => this.swap(widget),
			isEnabled: (widget?: Widget) => !!this.diffWidget(widget),
			isVisible: (widget?: Widget) => !!this.diffWidget(widget)
		});
	}

	registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
		toolbar.registerItem({
			id: SWAP_DIFF_SIDES.id,
			command: SWAP_DIFF_SIDES.id,
			icon: codicon('arrow-swap'),
			tooltip: 'Swap Left and Right Side',
			priority: 15,
			isVisible: widget => !!this.diffWidget(widget)
		});
	}

	protected diffWidget(widget?: Widget): EditorWidget | undefined {
		for (const candidate of widget ? [widget] : [this.shell.activeWidget, this.shell.currentWidget]) {
			if (candidate instanceof EditorWidget && candidate.editor instanceof MonacoDiffEditor && DiffUris.isDiffUri(candidate.editor.uri)) {
				return candidate;
			}
		}
		return undefined;
	}

	protected async swap(widget?: Widget): Promise<void> {
		const source = this.diffWidget(widget);
		if (!source || source.isDisposed || !this.shell.getTabBarFor(source)) {
			return;
		}

		const area = this.shell.getAreaFor(source);
		if (!area) {
			return;
		}
		const originalUri = source.editor.uri;
		const [original, modified] = DiffUris.decode(originalUri);
		const [newOriginal, newModified] = swapDiffInputs(original, modified);
		const swappedUri = DiffUris.encode(newOriginal, newModified, originalUri.path.toString());
		const sourceSaveable = Saveable.get(source);
		const retainsSource = (): boolean => !!sourceSaveable && this.editorManager.all.some(other => other !== source && !other.isDisposed && Saveable.get(other) === sourceSaveable);

		// The old modified side becomes read only after the swap. Keep an editable
		// tab for its unsaved model so closing the comparison cannot discard changes.
		if (sourceSaveable?.dirty && !retainsSource()) {
			await this.editorManager.open(modified, { preview: false, mode: 'open', widgetOptions: { area, mode: 'tab-after', ref: source } });
			if (!retainsSource()) {
				throw new Error('Cannot swap diff sides without retaining unsaved changes');
			}
		}

		const swapped = await this.editorManager.open(swappedUri, { preview: false, widgetOptions: { area, mode: 'tab-before', ref: source } });
		if (source.isDisposed) {
			await this.shell.activateWidget(swapped.id);
			return;
		}

		if (sourceSaveable?.dirty) {
			if (!retainsSource() || !SaveableWidget.is(source)) {
				throw new Error('Cannot close the original comparison without losing unsaved changes');
			}
			await source.closeWithoutSaving(false);
		} else {
			await this.shell.closeWidget(source.id);
		}
		await this.shell.activateWidget(swapped.id);
	}
}
