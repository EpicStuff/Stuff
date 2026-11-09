import { promises as fs } from 'fs';
import * as path from 'path';

export interface ResolvedPathTarget {
	path: string;
	isWorkspace: boolean;
	exists: boolean;
}

export async function resolveWindowPathTarget(inputPath: string, cwd: string): Promise<ResolvedPathTarget> {
	const requestedPath = path.resolve(cwd, inputPath);
	let resolvedPath: string;
	try {
		resolvedPath = await fs.realpath(requestedPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { path: requestedPath, isWorkspace: false, exists: false };
		}
		throw error;
	}
	const stat = await fs.stat(resolvedPath);
	if (!stat.isDirectory() && !stat.isFile()) {
		throw new Error('Path is not a file or directory: ' + inputPath);
	}
	const extension = path.extname(resolvedPath).toLowerCase();
	return {
		path: resolvedPath,
		isWorkspace: stat.isDirectory() || extension === '.theia-workspace' || extension === '.code-workspace',
		exists: true
	};
}
