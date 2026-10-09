// Shared by the native extensions to fail their build when the upstream Theia code they patch or rely on has changed.
// Each extension pins the exact upstream snippets it depends on; a mismatch means the extension needs to be re-verified
// against the new Theia version before the snippets are updated.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const baselineTheiaVersion = '1.75.0';

export function countOccurrences(source, needle) {
	let count = 0;
	let offset = 0;

	while ((offset = source.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}

	return count;
}

export function requireExactlyOnce(source, needle, message) {
	const count = countOccurrences(source, needle);
	if (count !== 1) {
		throw new Error(`${message} Expected exactly one implementation verified against Theia ${baselineTheiaVersion}, found ${count}.`);
	}
}

export function requireAbsent(source, needle, message) {
	const count = countOccurrences(source, needle);
	if (count !== 0) {
		throw new Error(`${message} Expected none, as in Theia ${baselineTheiaVersion}, found ${count}.`);
	}
}

// from is the caller's import.meta.url, so packages resolve from the extension's own node_modules chain.
export function theiaSourcePath(from, packageName, relativePath) {
	const packageJsonPath = createRequire(from).resolve(`${packageName}/package.json`);
	return path.join(path.dirname(packageJsonPath), relativePath);
}

// checks: [{ package, file, expect: [{ snippet, message, absent? }] }]
// Every check runs before failing, so one build reports everything that moved.
export async function verifyTheiaSources(from, checks) {
	const failures = [];

	for (const check of checks) {
		let source;
		try {
			source = await fs.readFile(theiaSourcePath(from, check.package, check.file), 'utf8');
		} catch (error) {
			failures.push(`Missing ${check.package}/${check.file}: ${error instanceof Error ? error.message : error}`);
			continue;
		}

		for (const expectation of check.expect) {
			try {
				(expectation.absent ? requireAbsent : requireExactlyOnce)(source, expectation.snippet, expectation.message);
			} catch (error) {
				failures.push(`${check.package}/${check.file}: ${error.message}`);
			}
		}
	}

	if (failures.length > 0) {
		throw new Error(`Upstream Theia code changed since this extension was verified:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
	}
}
