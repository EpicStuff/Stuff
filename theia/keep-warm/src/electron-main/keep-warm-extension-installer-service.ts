import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';

interface StoredWindowSession {
	workspaces: string[];
}

@injectable()
export class KeepWarmExtensionInstallerServiceImpl implements KeepWarmExtensionInstallerService {
	protected readonly clients = new Set<KeepWarmExtensionInstallerClient>();
	protected readonly clientsByWindowId = new Map<number, KeepWarmExtensionInstallerClient>();
	protected readonly workspaceByWindowId = new Map<number, string>();
	protected readonly sessionWorkspaces = new Set<string>();
	protected readonly waiters: Array<(client: KeepWarmExtensionInstallerClient) => void> = [];
	protected readonly windowWaiters = new Map<number, Array<(client: KeepWarmExtensionInstallerClient) => void>>();
	protected sessionLoaded = false;
	protected sessionWrite = Promise.resolve();

	setClient(client: KeepWarmExtensionInstallerClient | undefined): void {
		if (client) {
			this.addClient(client);
		}
	}

	getClient(): KeepWarmExtensionInstallerClient | undefined {
		return this.clients.values().next().value;
	}

	addClient(client: KeepWarmExtensionInstallerClient): void {
		this.clients.add(client);
		let waiter = this.waiters.shift();
		while (waiter) {
			waiter(client);
			waiter = this.waiters.shift();
		}

		void client.getWindowId().then(async windowId => {
			if (!this.clients.has(client)) {
				return;
			}

			this.clientsByWindowId.set(windowId, client);
			const windowWaiters = this.windowWaiters.get(windowId);
			if (windowWaiters) {
				this.windowWaiters.delete(windowId);
				for (const windowWaiter of windowWaiters) {
					windowWaiter(client);
				}
			}

			const workspacePath = await client.getWorkspacePath();
			if (this.clients.has(client)) {
				await this.recordWindowWorkspace(windowId, workspacePath);
			}
		}).catch(() => undefined);
	}

	disconnectClient(client: KeepWarmExtensionInstallerClient): void {
		this.clients.delete(client);
		for (const [windowId, mappedClient] of this.clientsByWindowId) {
			if (mappedClient === client) {
				this.clientsByWindowId.delete(windowId);
			}
		}
	}

	async openWorkspace(windowId: number, workspacePath: string): Promise<void> {
		const client = await this.waitForClient(windowId);
		await client.openWorkspace(workspacePath);
	}

	async openFile(windowId: number, filePath: string, line?: number, column?: number): Promise<void> {
		const client = await this.waitForClient(windowId);
		await client.openFile(filePath, line, column);
	}

	async openDiff(windowId: number, leftPath: string, rightPath: string): Promise<void> {
		const client = await this.waitForClient(windowId);
		await client.openDiff(leftPath, rightPath);
	}

	async getRestorableWorkspaces(): Promise<string[]> {
		await this.ensureSessionLoaded();
		return [...this.sessionWorkspaces];
	}

	async replaceSession(workspaces: readonly string[]): Promise<void> {
		await this.ensureSessionLoaded();
		this.sessionWorkspaces.clear();
		for (const workspacePath of workspaces) {
			this.sessionWorkspaces.add(workspacePath);
		}
		this.workspaceByWindowId.clear();
		await this.persistSession();
	}

	async forgetWindow(windowId: number): Promise<void> {
		await this.ensureSessionLoaded();
		const workspacePath = this.workspaceByWindowId.get(windowId);
		this.workspaceByWindowId.delete(windowId);
		if (!workspacePath) {
			return;
		}

		if (![...this.workspaceByWindowId.values()].includes(workspacePath)) {
			this.sessionWorkspaces.delete(workspacePath);
			await this.persistSession();
		}
	}

	dispose(): void {
		this.clients.clear();
		this.clientsByWindowId.clear();
		this.workspaceByWindowId.clear();
		this.waiters.splice(0);
		this.windowWaiters.clear();
	}

	protected async recordWindowWorkspace(windowId: number, workspacePath: string | undefined): Promise<void> {
		await this.ensureSessionLoaded();
		const previousWorkspacePath = this.workspaceByWindowId.get(windowId);

		if (previousWorkspacePath && previousWorkspacePath !== workspacePath &&
			![...this.workspaceByWindowId.entries()].some(([id, candidate]) => id !== windowId && candidate === previousWorkspacePath)) {
			this.sessionWorkspaces.delete(previousWorkspacePath);
		}

		if (workspacePath) {
			this.workspaceByWindowId.set(windowId, workspacePath);
			this.sessionWorkspaces.add(workspacePath);
		} else {
			this.workspaceByWindowId.delete(windowId);
		}

		await this.persistSession();
	}

	protected async ensureSessionLoaded(): Promise<void> {
		if (this.sessionLoaded) {
			return;
		}
		this.sessionLoaded = true;

		try {
			const raw = await fs.readFile(this.sessionPath, 'utf8');
			const parsed = JSON.parse(raw) as Partial<StoredWindowSession>;
			if (Array.isArray(parsed.workspaces)) {
				for (const workspacePath of parsed.workspaces) {
					if (typeof workspacePath === 'string' && workspacePath.length > 0) {
						this.sessionWorkspaces.add(workspacePath);
					}
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				console.warn('Could not read Theia window session.', error);
			}
		}
	}

	protected persistSession(): Promise<void> {
		const snapshot: StoredWindowSession = {
			workspaces: [...this.sessionWorkspaces]
		};

		this.sessionWrite = this.sessionWrite.catch(() => undefined).then(async () => {
			await fs.mkdir(path.dirname(this.sessionPath), { recursive: true });
			const temporaryPath = `${this.sessionPath}.tmp`;
			await fs.writeFile(temporaryPath, JSON.stringify(snapshot, undefined, '\t') + '\n', 'utf8');
			await fs.rename(temporaryPath, this.sessionPath);
		});

		return this.sessionWrite;
	}

	protected get sessionPath(): string {
		return path.join(app.getPath('userData'), 'theia-window-session.json');
	}

	protected async waitForClient(windowId?: number): Promise<KeepWarmExtensionInstallerClient> {
		if (windowId !== undefined) {
			const windowClient = this.clientsByWindowId.get(windowId);
			if (windowClient) {
				return windowClient;
			}
			return new Promise(resolve => {
				const waiters = this.windowWaiters.get(windowId) ?? [];
				waiters.push(resolve);
				this.windowWaiters.set(windowId, waiters);
			});
		}

		const client = this.getClient();
		if (client) {
			return client;
		}
		return new Promise(resolve => this.waiters.push(resolve));
	}
}
