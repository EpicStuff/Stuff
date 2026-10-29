const assert = require('node:assert/strict');
const { test } = require('node:test');
const { whenFrontendReady } = require('../lib/electron-browser/when-frontend-ready.js');

test('a new window cannot register until the workbench layout is ready', async () => {
	let markReady;
	const ready = new Promise(resolve => { markReady = resolve; });
	const observed = [];
	const state = { reachedState: stateName => {
		observed.push(stateName);
		return ready;
	} };
	let windowIdRequested = false;
	const registration = whenFrontendReady(state, () => {
		windowIdRequested = true;
		return 37;
	});
	await Promise.resolve();
	assert.deepEqual(observed, ['ready']);
	assert.equal(windowIdRequested, false);
	markReady();
	assert.equal(await registration, 37);
	assert.equal(windowIdRequested, true);
});

test('an existing ready window can register immediately', async () => {
	const state = { reachedState: () => Promise.resolve() };
	assert.equal(await whenFrontendReady(state, () => 42), 42);
});

test('failed workbench startup does not register a window', async () => {
	const state = { reachedState: () => Promise.reject(new Error('frontend startup failed')) };
	let registered = false;
	await assert.rejects(whenFrontendReady(state, () => { registered = true; }), /frontend startup failed/);
	assert.equal(registered, false);
});
