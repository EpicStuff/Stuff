export type WordWrapOverride = 'on' | 'off' | 'inherit';

export function nextWordWrapOverride(current: WordWrapOverride, currentlyWrapped: boolean): WordWrapOverride {
	return current === 'inherit' ? (currentlyWrapped ? 'off' : 'on') : 'inherit';
}

/** Copy a diff's temporary override to the other side only if it has none. */
export function syncedDiffWordWrapOverride(original: WordWrapOverride, modified: WordWrapOverride): 'on' | 'off' | undefined {
	if (original !== 'inherit' && modified === 'inherit') {
		return original;
	}
	if (modified !== 'inherit' && original === 'inherit') {
		return modified;
	}
	return undefined;
}
