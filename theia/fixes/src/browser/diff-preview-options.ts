/** Use the regular editor preview default for diffs unless the caller explicitly chooses. */
export function diffPreviewOptions<T extends { preview?: boolean }>(isDiff: boolean, options?: T): T | (T & { preview: true }) | undefined {
	if (!isDiff || options?.preview !== undefined) {
		return options;
	}
	return { ...options, preview: true } as T & { preview: true };
}
