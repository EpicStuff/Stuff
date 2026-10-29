import { CommandRegistry } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import { KeymapsCommands, KeymapsFrontendContribution } from '@theia/keymaps/lib/browser/keymaps-frontend-contribution';

/** Open Keyboard Shortcuts JSON in a normal editor tab, like Settings JSON. */
@injectable()
export class TabbedKeymapsFrontendContribution extends KeymapsFrontendContribution {
	override registerCommands(commands: CommandRegistry): void {
		super.registerCommands(commands);
		const handler = commands.getAllHandlers(KeymapsCommands.OPEN_KEYMAPS_JSON_TOOLBAR.id)[0];
		if (!handler) {
			throw new Error('Theia did not register the Keyboard Shortcuts JSON toolbar command');
		}
		// The stock toolbar handler passes the settings widget as a reference,
		// which makes KeymapsService.open() request a split-right editor.
		handler.execute = widget => this.withWidget(widget, () => this.keymaps.open());
	}
}
