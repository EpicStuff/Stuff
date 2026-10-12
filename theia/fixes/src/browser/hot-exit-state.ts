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
