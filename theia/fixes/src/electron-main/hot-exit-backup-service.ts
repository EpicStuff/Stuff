import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { HotExitBackup, HotExitBackupService } from '../common/hot-exit-protocol';

@injectable()
export class HotExitBackupServiceImpl implements HotExitBackupService {
	private readonly operations = new Map<string, Promise<void>>();
	private nextTemporaryId = 0;

	async list(workspace: string): Promise<HotExitBackup[]> {
		let names: string[];
		try {
			names = await fs.readdir(this.directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
		const result: HotExitBackup[] = [];
		for (const name of names.filter(name => name.endsWith('.json'))) {
			try {
				const backup: unknown = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'));
				if (this.isBackup(backup) && backup.workspace === workspace) {
					result.push(backup);
				}
			} catch (error) {
				console.warn('Unable to read a Hot Exit backup:', name, error);
			}
		}
		return result;
	}

	write(backup: HotExitBackup): Promise<void> {
		if (!this.isBackup(backup)) {
			return Promise.reject(new Error('Invalid Hot Exit backup'));
		}
		return this.enqueue(backup.workspace, backup.uri, async () => {
			await fs.mkdir(this.directory, { recursive: true });
			const target = this.filename(backup.workspace, backup.uri);
			const temporary = target + '.' + process.pid + '.' + this.nextTemporaryId++ + '.tmp';
			try {
				await fs.writeFile(temporary, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 });
				await fs.rename(temporary, target);
			} finally {
				await fs.unlink(temporary).catch(error => {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}
				});
			}
		});
	}

	remove(workspace: string, uri: string): Promise<void> {
		return this.enqueue(workspace, uri, async () => {
			try {
				await fs.unlink(this.filename(workspace, uri));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}
		});
	}

	private enqueue(workspace: string, uri: string, operation: () => Promise<void>): Promise<void> {
		const key = workspace + '\0' + uri;
		const pending = (this.operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
		this.operations.set(key, pending);
		void pending.finally(() => {
			if (this.operations.get(key) === pending) {
				this.operations.delete(key);
			}
		}).catch(() => undefined);
		return pending;
	}

	private isBackup(value: unknown): value is HotExitBackup {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const candidate = value as Partial<HotExitBackup>;
		return typeof candidate.workspace === 'string' && typeof candidate.uri === 'string' && candidate.uri.length > 0 && typeof candidate.baseContent === 'string' && typeof candidate.content === 'string';
	}

	private filename(workspace: string, uri: string): string {
		const digest = createHash('sha256').update(workspace).update('\0').update(uri).digest('hex');
		return path.join(this.directory, digest + '.json');
	}

	private get directory(): string {
		return path.join(app.getPath('userData'), 'hot-exit-backups');
	}
}
