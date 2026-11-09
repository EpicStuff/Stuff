const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { revealEditorWindow } = require('../lib/electron-main/window-attention.js');

class MockWindow extends EventEmitter {
	destroyed = false;
	minimized = false;
	visible = true;
	focused = false;
	actions = [];

	isDestroyed() { return this.destroyed; }
	isMinimized() { return this.minimized; }
	isVisible() { return this.visible; }
	isFocused() { return this.focused; }
	restore() { this.minimized = false; this.actions.push('restore'); }
	show() { this.visible = true; this.actions.push('show'); }
	focus() { this.actions.push('focus'); }
	flashFrame(flag) { this.actions.push(flag ? 'flash-on' : 'flash-off'); }
}

test('already focused window needs no attention flash', () => {
	const window = new MockWindow();
	window.focused = true;
	revealEditorWindow(window);
	assert.deepEqual(window.actions, ['focus']);
});

test('focus is requested and denied requests taskbar attention', () => {
	const window = new MockWindow();
	window.minimized = true;
	window.visible = false;
	revealEditorWindow(window);
	assert.deepEqual(window.actions, ['restore', 'show', 'focus', 'flash-on']);
	window.focused = true;
	window.emit('focus');
	assert.deepEqual(window.actions, ['restore', 'show', 'focus', 'flash-on', 'flash-off']);
});

test('repeated requests do not register duplicate handlers', () => {
	const window = new MockWindow();
	revealEditorWindow(window);
	revealEditorWindow(window);
	assert.deepEqual(window.actions, ['focus', 'flash-on', 'focus']);
	window.emit('focus');
	assert.deepEqual(window.actions, ['focus', 'flash-on', 'focus', 'flash-off']);
});

test('destroyed windows are ignored', () => {
	const window = new MockWindow();
	window.destroyed = true;
	revealEditorWindow(window);
	assert.deepEqual(window.actions, []);
});
