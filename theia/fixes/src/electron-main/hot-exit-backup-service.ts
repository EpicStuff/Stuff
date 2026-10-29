import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { HotExitBackup, HotExitBackupService } from '../common/hot-exit-protocol';

@injectable()
export class HotExitBackupServiceImpl implements HotExitBackupService {
	private readonly operations = new Map<string, Promise<void>>();
	private readonly runId = randomUUID();
	private nextTemporaryId = 0;

	async list(workspace: string, windowId: number): Promise<HotExitBackup[]> {
		this.validateWindow(windowId);
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
				if (this.isBackup(backup) && backup.workspace === workspace && (!backup.owner || !this.isOtherLiveWindow(backup.owner, windowId))) {
					result.push(backup);
				}
			} catch (error) {
				console.warn('Unable to read a Hot Exit backup:', name, error);
			}
		}
		return result;
	}

	write(backup: HotExitBackup, windowId: number): Promise<void> {
		this.validateWindow(windowId);
		if (!this.isBackup(backup)) {
			return Promise.reject(new Error('Invalid Hot Exit backup'));
		}
		const ownedBackup = { ...backup, owner: this.owner(windowId) };
		return this.enqueue(backup.workspace, backup.uri, ownedBackup.owner, async () => {
			await fs.mkdir(this.directory, { recursive: true });
			const target = this.filename(backup.workspace, backup.uri, ownedBackup.owner);
			const temporary = target + '.' + process.pid + '.' + this.nextTemporaryId++ + '.tmp';
			try {
				await fs.writeFile(temporary, JSON.stringify(ownedBackup), { encoding: 'utf8', mode: 0o600 });
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

	remove(workspace: string, uri: string, windowId: number): Promise<void> {
		this.validateWindow(windowId);
		return this.deleteFile(workspace, uri, this.owner(windowId));
	}

	removeRecovered(backup: HotExitBackup, windowId: number): Promise<void> {
		this.validateWindow(windowId);
		if (!this.isBackup(backup) || backup.owner === this.owner(windowId) || backup.owner && this.isOtherLiveWindow(backup.owner, windowId)) {
			return Promise.resolve();
		}
		return this.enqueue(backup.workspace, backup.uri, backup.owner, async () => {
			const filename = this.filename(backup.workspace, backup.uri, backup.owner);
			try {
				const stored: unknown = JSON.parse(await fs.readFile(filename, 'utf8'));
				if (this.isBackup(stored) && stored.owner === backup.owner && stored.content === backup.content && stored.baseContent === backup.baseContent) {
					await fs.unlink(filename);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}
		});
	}

	private deleteFile(workspace: string, uri: string, owner: string): Promise<void> {
		return this.enqueue(workspace, uri, owner, async () => {
			try {
				await fs.unlink(this.filename(workspace, uri, owner));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}
		});
	}

	private enqueue(workspace: string, uri: string, owner: string | undefined, operation: () => Promise<void>): Promise<void> {
		const key = workspace + '\0' + uri + '\0' + (owner ?? '');
		const pending = (this.operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
		this.operations.set(key, pending);
		void pending.finally(() => {
			if (this.operations.get(key) === pending) {
				this.operations.delete(key);
			}
		}).catch(() => undefined);
		return pending;
	}

	private validateWindow(windowId: number): void {
		if (!Number.isSafeInteger(windowId) || windowId <= 0 || !BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.webContents.id === windowId)) {
			throw new Error('Hot Exit: invalid or closed Electron window');
		}
	}

	private owner(windowId: number): string {
		return this.runId + ':' + windowId;
	}

	private isOtherLiveWindow(owner: string, currentWindowId: number): boolean {
		const split = owner.lastIndexOf(':');
		if (split === -1 || owner.slice(0, split) !== this.runId) {
			return false;
		}
		const ownerWindowId = Number(owner.slice(split + 1));
		return ownerWindowId !== currentWindowId && BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.webContents.id === ownerWindowId);
	}

	private isBackup(value: unknown): value is HotExitBackup {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const candidate = value as Partial<HotExitBackup>;
		return typeof candidate.workspace === 'string' && typeof candidate.uri === 'string' && candidate.uri.length > 0 && typeof candidate.baseContent === 'string' && typeof candidate.content === 'string' && (candidate.owner === undefined || typeof candidate.owner === 'string');
	}

	private filename(workspace: string, uri: string, owner?: string): string {
		const digest = createHash('sha256').update(workspace).update('\0').update(uri);
		if (owner !== undefined) {
			digest.update('\0').update(owner);
		}
		return path.join(this.directory, digest.digest('hex') + '.json');
	}

	private get directory(): string {
		return path.join(app.getPath('userData'), 'hot-exit-backups');
	}
}
