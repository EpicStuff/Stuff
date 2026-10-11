/**
 * Monaco's folding contribution saves a memento containing region boundaries and
 * checksums. Keep only this contribution, not the cursor or scroll view state.
 */
export const FOLDING_CONTRIBUTION_ID = 'editor.contrib.folding';

export interface FoldRegion {
	startLineNumber: number;
	endLineNumber: number;
	isCollapsed?: boolean;
	checksum?: number;
	source?: number;
}

export interface FoldingState {
	collapsedRegions?: FoldRegion[];
	lineCount?: number;
	provider?: string;
	foldedImports?: boolean;
}

export type StoredFoldingStates = Record<string, FoldingState>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseFoldingState(value: unknown): FoldingState | undefined {
	const raw = asRecord(value);
	if (!raw || (raw.collapsedRegions === undefined && !Number.isInteger(raw.lineCount))) {
		return undefined;
	}
	if (raw.collapsedRegions !== undefined && !Array.isArray(raw.collapsedRegions)) {
		return undefined;
	}

	const regions: FoldRegion[] = [];
	for (const entry of raw.collapsedRegions ?? []) {
		const region = asRecord(entry);
		if (!region || !Number.isInteger(region.startLineNumber) || !Number.isInteger(region.endLineNumber) || (region.startLineNumber as number) < 1 || (region.endLineNumber as number) <= (region.startLineNumber as number)) {
			return undefined;
		}
		if (region.checksum !== undefined && (typeof region.checksum !== 'number' || !Number.isFinite(region.checksum))) {
			return undefined;
		}
		if (region.isCollapsed !== undefined && typeof region.isCollapsed !== 'boolean') {
			return undefined;
		}
		if (region.source !== undefined && typeof region.source !== 'number') {
			return undefined;
		}
		regions.push({
			startLineNumber: region.startLineNumber as number,
			endLineNumber: region.endLineNumber as number,
			...(region.isCollapsed === undefined ? {} : { isCollapsed: region.isCollapsed as boolean }),
			...(region.checksum === undefined ? {} : { checksum: region.checksum as number }),
			...(region.source === undefined ? {} : { source: region.source as number })
		});
	}

	return {
		...(raw.collapsedRegions === undefined ? {} : { collapsedRegions: regions }),
		...(Number.isInteger(raw.lineCount) && (raw.lineCount as number) >= 1 ? { lineCount: raw.lineCount as number } : {}),
		...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
		...(typeof raw.foldedImports === 'boolean' ? { foldedImports: raw.foldedImports } : {})
	};
}

export function readFoldingFromViewState(viewState: unknown): FoldingState | undefined {
	const contributions = asRecord(asRecord(viewState)?.contributionsState);
	return parseFoldingState(contributions?.[FOLDING_CONTRIBUTION_ID]);
}

export function mergeFoldingIntoViewState<T extends { contributionsState: Record<string, unknown> }>(current: T, folded: FoldingState): T {
	return {
		...current,
		contributionsState: {
			...current.contributionsState,
			[FOLDING_CONTRIBUTION_ID]: folded
		}
	};
}

export function sanitizeStoredFoldingStates(value: unknown): StoredFoldingStates {
	const stored: StoredFoldingStates = Object.create(null) as StoredFoldingStates;
	const raw = asRecord(value);
	if (!raw) {
		return stored;
	}
	for (const [uri, data] of Object.entries(raw)) {
		const state = parseFoldingState(data);
		if (state?.collapsedRegions?.length) {
			stored[uri] = state;
		}
	}
	return stored;
}
