import { promises as fs } from 'fs';
import * as path from 'path';

export interface DiffFileTarget {
	path: string;
	exists: boolean;
}

export async function resolveDiffFileTarget(inputPath: string, cwd: string): Promise<DiffFileTarget> {
	const requestedPath = path.resolve(cwd, inputPath);
	let resolvedPath: string;
	try {
		resolvedPath = await fs.realpath(requestedPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { path: requestedPath, exists: false };
		}
		throw error;
	}

	const stat = await fs.stat(resolvedPath);
	if (stat.isFile()) {
		return { path: resolvedPath, exists: true };
	}
	if (process.platform !== 'win32' && resolvedPath === '/dev/null') {
		return { path: resolvedPath, exists: false };
	}
	throw new Error('Path is not a file: ' + inputPath);
}
