import { HotExitBackup } from '../common/hot-exit-protocol';

export type RecoveryDecision = 'restore' | 'unchanged' | 'conflict';

export function decideHotExitRecovery(backup: HotExitBackup, currentContent: string, dirty: boolean): RecoveryDecision {
	if (dirty) {
		return 'conflict';
	}
	if (currentContent === backup.content) {
		return 'unchanged';
	}
	return currentContent === backup.baseContent ? 'restore' : 'conflict';
}

export function selectHotExitBackups(backups: readonly HotExitBackup[]): { selected: Map<string, HotExitBackup>; conflicts: Set<string> } {
	const selected = new Map<string, HotExitBackup>();
	const conflicts = new Set<string>();
	for (const backup of backups) {
		if (selected.has(backup.uri)) {
			selected.delete(backup.uri);
			conflicts.add(backup.uri);
		} else if (!conflicts.has(backup.uri)) {
			selected.set(backup.uri, backup);
		}
	}
	return { selected, conflicts };
}
