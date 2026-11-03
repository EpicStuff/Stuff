/** Preserve both document references while reversing their original and modified roles. */
export function swapDiffInputs<T>(original: T, modified: T): [T, T] {
	return [modified, original];
}
