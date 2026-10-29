// A window is not ready to receive editor requests merely because its IPC
// connection exists. Theia restores the layout after starting contributions.
export interface FrontendReadyState {
	reachedState(state: 'ready'): Promise<void>;
}

export async function whenFrontendReady<T>(state: FrontendReadyState, work: () => T | Promise<T>): Promise<T> {
	await state.reachedState('ready');
	return work();
}
