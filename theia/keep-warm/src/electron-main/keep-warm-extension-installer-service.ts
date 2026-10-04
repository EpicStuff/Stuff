import { injectable } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';

@injectable()
export class KeepWarmExtensionInstallerServiceImpl implements KeepWarmExtensionInstallerService {
	protected readonly clients = new Set<KeepWarmExtensionInstallerClient>();
	protected readonly clientsByWindowId = new Map<number, KeepWarmExtensionInstallerClient>();
	protected readonly waiters: Array<(client: KeepWarmExtensionInstallerClient) => void> = [];
	protected readonly windowWaiters = new Map<number, Array<(client: KeepWarmExtensionInstallerClient) => void>>();

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

		void client.getWindowId().then(windowId => {
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
		});
	}

	disconnectClient(client: KeepWarmExtensionInstallerClient): void {
		this.clients.delete(client);
		for (const [windowId, mappedClient] of this.clientsByWindowId) {
			if (mappedClient === client) {
				this.clientsByWindowId.delete(windowId);
			}
		}
	}

	async installExtension(windowId: number, extension: string, local: boolean): Promise<void> {
		const client = await this.waitForClient(windowId);
		await client.installExtension(extension, local);
	}

	async uninstallExtension(windowId: number, extensionId: string): Promise<string> {
		const client = await this.waitForClient(windowId);
		return client.uninstallExtension(extensionId);
	}

	async listExtensions(windowId: number, showVersions: boolean): Promise<string[]> {
		const client = await this.waitForClient(windowId);
		return client.listExtensions(showVersions);
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

	dispose(): void {
		this.clients.clear();
		this.clientsByWindowId.clear();
		this.waiters.splice(0);
		this.windowWaiters.clear();
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
