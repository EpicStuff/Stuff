export interface HotExitBackup {
	workspace: string;
	uri: string;
	baseContent: string;
	content: string;
	/** Identifier of the window that wrote the backup, assigned by the Electron main process. */
	owner?: string;
}

export const HotExitBackupService = Symbol('HotExitBackupService');
export const HotExitBackupServicePath = '/services/theia-fixes/hot-exit';

export interface HotExitBackupService {
	list(workspace: string, windowId: number): Promise<HotExitBackup[]>;
	write(backup: HotExitBackup, windowId: number): Promise<void>;
	remove(workspace: string, uri: string, windowId: number): Promise<void>;
	removeRecovered(backup: HotExitBackup, windowId: number): Promise<void>;
}
