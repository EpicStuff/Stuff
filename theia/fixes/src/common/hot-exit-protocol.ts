export interface HotExitBackup {
	workspace: string;
	uri: string;
	baseContent: string;
	content: string;
}

export const HotExitBackupService = Symbol('HotExitBackupService');
export const HotExitBackupServicePath = '/services/theia-fixes/hot-exit';

export interface HotExitBackupService {
	list(workspace: string): Promise<HotExitBackup[]>;
	write(backup: HotExitBackup): Promise<void>;
	remove(workspace: string, uri: string): Promise<void>;
}
