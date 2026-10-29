import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommandSearchFilter, matchesCommandSearchFilter } from '../lib/browser/keybinding-command-search.js';

test('VS Code exact command syntax matches only the selected ID', () => {
	const filter = parseCommandSearchFilter('@command:core.nextTab');
	assert.deepEqual(filter, { command: 'core.nextTab' });
	assert.equal(matchesCommandSearchFilter('core.nextTab', undefined, filter), true);
	assert.equal(matchesCommandSearchFilter('core.nextTabInGroup', undefined, filter), false);
});

test('directive name ignores case without altering the command ID', () => {
	assert.deepEqual(parseCommandSearchFilter('@COMMAND:core.nextTab'), { command: 'core.nextTab' });
	assert.equal(matchesCommandSearchFilter('core.nexttab', undefined, parseCommandSearchFilter('@COMMAND:core.nextTab')), false);
});

test('VS Code optional +when filter restricts the exact command', () => {
	const filter = parseCommandSearchFilter('@command:workbench.action.test +when:editorTextFocus');
	assert.deepEqual(filter, { command: 'workbench.action.test', when: 'editorTextFocus' });
	assert.equal(matchesCommandSearchFilter('workbench.action.test', 'editorTextFocus', filter), true);
	assert.equal(matchesCommandSearchFilter('workbench.action.test', 'terminalFocus', filter), false);
});

test('plain text is not treated as an explicit command filter', () => {
	assert.equal(parseCommandSearchFilter('core.nextTab'), undefined);
	assert.equal(parseCommandSearchFilter('Show Next Tab'), undefined);
	assert.equal(parseCommandSearchFilter(''), undefined);
});
