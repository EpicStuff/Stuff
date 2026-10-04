import { injectable } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';

@injectable()
export class KeepWarmExtensionInstallerServiceImpl implements KeepWarmExtensionInstallerService {
	protected readonly clients = new Set<KeepWarmExtensionInstallerClient>();
	protected readonly waiters: Array<(client: KeepWarmExtensionInstallerClient) => void> = [];

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
	}

	disconnectClient(client: KeepWarmExtensionInstallerClient): void {
		this.clients.delete(client);
	}

	async installExtension(extensionPath: string): Promise<void> {
		const client = await this.waitForClient();
		await client.installExtension(extensionPath);
	}

	dispose(): void {
		this.clients.clear();
		this.waiters.splice(0);
	}

	protected async waitForClient(): Promise<KeepWarmExtensionInstallerClient> {
		const client = this.getClient();
		if (client) {
			return client;
		}
		return new Promise(resolve => this.waiters.push(resolve));
	}
}
