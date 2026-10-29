import { injectable } from '@theia/core/shared/inversify';
import { KeybindingItem, KeybindingWidget } from '@theia/keymaps/lib/browser/keybindings-widget';
import { matchesCommandSearchFilter, parseCommandSearchFilter } from './keybinding-command-search';

/** Extend Theia's own shortcut editor with VS Code command ID search. */
@injectable()
export class VSCodeKeybindingWidget extends KeybindingWidget {
	protected override formatAndMatchCommand(item: KeybindingItem): boolean {
		const nameMatches = super.formatAndMatchCommand(item);
		item.labels.id = this.toRenderableLabel(item.command.id);
		return nameMatches || !!item.labels.id.segments;
	}

	protected override doSearchKeybindings(): void {
		const rawQuery = this.findSearchField()?.value.trim() ?? '';
		const filter = parseCommandSearchFilter(rawQuery);
		if (!filter) {
			// Preserve Theia's built in name, shortcut, context and source searching.
			super.doSearchKeybindings();
			return;
		}

		this.query = rawQuery.toLocaleLowerCase();
		this.onDidUpdateEmitter.fire(undefined);
		for (const item of this.items) {
			const when = item.keybinding?.when ?? item.keybinding?.context;
			item.visible = matchesCommandSearchFilter(item.command.id, when, filter);
			item.labels.id = this.toRenderableLabel(item.command.id, filter.command);
			item.labels.command = this.toRenderableLabel(item.labels.command.value, '');
			item.labels.keybinding = { value: item.labels.keybinding.value };
			item.labels.context = { value: item.labels.context.value };
			item.labels.source = { value: item.labels.source.value };
		}
		this.sortKeybindings(this.items);
		this.items.sort((a, b) => Number(!!b.visible) - Number(!!a.visible));
		this.update();
	}
}
