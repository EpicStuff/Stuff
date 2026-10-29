// Match VS Code's default Explorer name ordering: numeric runs and shorter names on ties.
const collator = new Intl.Collator(undefined, { numeric: true });

export function compareExplorerNames(first: string, second: string): number {
	return collator.compare(first, second) || first.length - second.length;
}
