export type WordWrapOverride = 'on' | 'off' | 'inherit';

/** A temporary override belonging to a Monaco text model, not a user preference. */
export class TransientWordWrapState {
	private readonly states = new WeakMap<object, 'on' | 'off'>();

	get(model: object | null): WordWrapOverride {
		return model ? this.states.get(model) ?? 'inherit' : 'inherit';
	}

	set(model: object, override: WordWrapOverride): void {
		if (override === 'inherit') {
			this.states.delete(model);
		} else {
			this.states.set(model, override);
		}
	}

	/** The next toggle restores the configured wrap mode rather than forcing another mode. */
	toggle(model: object, currentlyWrapped: boolean): WordWrapOverride {
		const previous = this.get(model);
		const next = previous === 'inherit' ? (currentlyWrapped ? 'off' : 'on') : 'inherit';
		this.set(model, next);
		return next;
	}
}
