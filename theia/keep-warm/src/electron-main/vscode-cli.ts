const THEIA_PASSTHROUGH_OPTIONS = new Set([
	'--app-project-path',
	'--attach-container',
	'--cert',
	'--certkey',
	'--dev-json',
	'--dnsDefaultResultOrder',
	'--electronUserData',
	'--extensionTestsPath',
	'--hostname',
	'--install-plugin',
	'--log-config',
	'--log-file',
	'--log-level',
	'--no-cluster',
	'--no-dev-json',
	'--no-sandbox',
	'--open-url',
	'--ovsx-rate-limit',
	'--ovsx-router-config',
	'--plugin-max-session-logs-folders',
	'--pluginHostStopTimeout',
	'--pluginHostTerminateTimeout',
	'--plugins',
	'--port',
	'--proxy-authorization',
	'--proxy-url',
	'--remote',
	'--remote-auto-shutdown',
	'--remote-auto-shutdown-timeout',
	'--session-preference',
	'--set-preference',
	'--ssl',
	'--strict-ssl',
	'--uncompressed-plugins-in-place',
	'--vscode-api-version',
	'--watcher-verbose',
	'-p'
]);

export interface ParsedVscodeCliArgs {
	remainingArgs: string[];
	help: boolean;
	newWindow: boolean;
	reuseWindow: boolean;
	gotoTarget?: string;
	diffTargets?: [string, string];
	listExtensions: boolean;
	showVersions: boolean;
	installExtensions: string[];
	uninstallExtensions: string[];
	userDataDir?: string;
	disableGpu: boolean;
}

export interface GotoTarget {
	filePath: string;
	line: number;
	column: number;
}

export const VSCODE_COMPAT_HELP = `Usage: theia [options] [path]

VS Code compatible options:
  -h, --help                         Show this help
  -v, --version                      Show the application version
  -n, --new-window                   Force a new window
  -r, --reuse-window                 Force the last active window to be reused
  -g, --goto <file:line[:column]>    Open a file at the given line and column
  -d, --diff <file1> <file2>         Compare two files
      --list-extensions              List installed user extensions
      --show-versions                Show extension versions with --list-extensions
      --install-extension <id|vsix>  Install or update an extension
      --uninstall-extension <id>     Uninstall an extension
      --user-data-dir <dir>          Use an isolated Electron and Theia user data directory
      --disable-gpu                   Disable hardware acceleration

Theia custom options:
      --keep-warm                    Keep the Electron main process and backend resident
      --keep-warmer                  Also preload a hidden empty frontend renderer
      --daemon                       Detach the requested invocation from the terminal
      --quit                         Stop the resident keep warm instance
`;

export function parseVscodeCliArgs(args: readonly string[]): ParsedVscodeCliArgs {
	const parsed: ParsedVscodeCliArgs = {
		remainingArgs: [],
		help: false,
		newWindow: false,
		reuseWindow: false,
		listExtensions: false,
		showVersions: false,
		installExtensions: [],
		uninstallExtensions: [],
		disableGpu: false
	};

	const requireValue = (index: number, flag: string): string => {
		const value = args[index + 1];
		if (!value || value.startsWith('-')) {
			throw new Error(`${flag} requires a value`);
		}
		return value;
	};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];

		if (arg === '--') {
			parsed.remainingArgs.push(...args.slice(index));
			break;
		}

		switch (arg) {
			case '-h':
			case '--help':
				parsed.help = true;
				break;
			case '-n':
			case '--new-window':
				parsed.newWindow = true;
				break;
			case '-r':
			case '--reuse-window':
				parsed.reuseWindow = true;
				break;
			case '-g':
			case '--goto':
				parsed.gotoTarget = requireValue(index, arg);
				index++;
				break;
			case '-d':
			case '--diff': {
				const left = requireValue(index, arg);
				const right = args[index + 2];
				if (!right || right.startsWith('-')) {
					throw new Error(`${arg} requires two file paths`);
				}
				parsed.diffTargets = [left, right];
				index += 2;
				break;
			}
			case '--list-extensions':
				parsed.listExtensions = true;
				break;
			case '--show-versions':
				parsed.showVersions = true;
				break;
			case '--install-extension':
				parsed.installExtensions.push(requireValue(index, arg));
				index++;
				break;
			case '--uninstall-extension':
				parsed.uninstallExtensions.push(requireValue(index, arg));
				index++;
				break;
			case '--user-data-dir':
				parsed.userDataDir = requireValue(index, arg);
				index++;
				break;
			case '--disable-gpu':
				parsed.disableGpu = true;
				break;
			default:
				if (arg.startsWith('--install-extension=')) {
					parsed.installExtensions.push(requireInlineValue(arg, '--install-extension'));
				} else if (arg.startsWith('--uninstall-extension=')) {
					parsed.uninstallExtensions.push(requireInlineValue(arg, '--uninstall-extension'));
				} else if (arg.startsWith('--user-data-dir=')) {
					parsed.userDataDir = requireInlineValue(arg, '--user-data-dir');
				} else if (arg.startsWith('--goto=')) {
					parsed.gotoTarget = requireInlineValue(arg, '--goto');
				} else if (arg.startsWith('-') && !isKnownPassthroughOption(arg)) {
					throw new Error(`Unknown option '${arg}'`);
				} else {
					parsed.remainingArgs.push(arg);
				}
		}
	}

	if (parsed.newWindow && parsed.reuseWindow) {
		throw new Error('--new-window and --reuse-window cannot be used together');
	}
	if (parsed.gotoTarget && parsed.diffTargets) {
		throw new Error('--goto and --diff cannot be used together');
	}
	if (parsed.showVersions && !parsed.listExtensions) {
		throw new Error('--show-versions requires --list-extensions');
	}
	if ((parsed.installExtensions.length > 0 || parsed.uninstallExtensions.length > 0 || parsed.listExtensions) &&
		(parsed.newWindow || parsed.reuseWindow || parsed.gotoTarget || parsed.diffTargets)) {
		throw new Error('Extension management options cannot be combined with window opening options');
	}

	return parsed;
}

export function parseGotoTarget(target: string): GotoTarget {
	const match = /^(.*):(\d+)(?::(\d+))?$/.exec(target);
	if (!match || !match[1]) {
		throw new Error(`Invalid --goto target '${target}'. Expected file:line[:column]`);
	}

	const line = Number(match[2]);
	const column = match[3] ? Number(match[3]) : 1;
	if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
		throw new Error(`Invalid --goto target '${target}'. Line and column must be positive integers`);
	}

	return {
		filePath: match[1],
		line,
		column
	};
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(flag.length + 1);
	if (!value) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function isKnownPassthroughOption(arg: string): boolean {
	const separator = arg.indexOf('=');
	const option = separator >= 0 ? arg.slice(0, separator) : arg;
	return THEIA_PASSTHROUGH_OPTIONS.has(option);
}
