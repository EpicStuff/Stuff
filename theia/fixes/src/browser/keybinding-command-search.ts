// Use the same explicit command search syntax as VS Code's KeybindingsEditorModel.
const COMMAND_REGEX = /@command:\s*([^\+]+)/i;
const WHEN_REGEX = /\+when:\s*(.+)/i;

export interface CommandSearchFilter {
	command: string;
	when?: string;
}

export function parseCommandSearchFilter(query: string): CommandSearchFilter | undefined {
	const command = COMMAND_REGEX.exec(query)?.[1]?.trim();
	if (!command) {
		return undefined;
	}
	const when = WHEN_REGEX.exec(query)?.[1]?.trim();
	return when ? { command, when } : { command };
}

export function matchesCommandSearchFilter(commandId: string, when: string | undefined, filter: CommandSearchFilter): boolean {
	return commandId === filter.command && (filter.when === undefined || when === filter.when);
}
