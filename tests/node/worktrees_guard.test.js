'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { removalBlockers, PROTECTED_BRANCHES } = require('../../scripts/worktrees');

const SELF = path.join('C:', 'Projects', '.agents', 'current');
const clean = (over = {}) => ({
  dir: path.join('C:', 'Projects', '.agents', 'stale'),
  branch: 'agent/stale',
  isMain: false,
  dirty: 0,
  unpushed: 0,
  noUpstream: false,
  merged: true,
  outstanding: 0,
  activeRecently: false,
  ...over,
});

test('a clean, pushed, merged, idle worktree is removable', () => {
  assert.deepStrictEqual(removalBlockers(clean(), SELF), []);
});

test("the owner's folder is never removable", () => {
  const blockers = removalBlockers(clean({ isMain: true }), SELF);
  assert.ok(blockers.some((b) => b.includes("owner's folder")));
});

test('uncommitted work blocks removal', () => {
  assert.ok(removalBlockers(clean({ dirty: 1 }), SELF).length > 0);
});

test('commits that exist only on this disk block removal', () => {
  assert.ok(removalBlockers(clean({ unpushed: 2 }), SELF).length > 0);
  assert.ok(removalBlockers(clean({ noUpstream: true }), SELF).length > 0);
});

test('work not yet in main blocks removal', () => {
  assert.ok(removalBlockers(clean({ merged: false, outstanding: 3 }), SELF).length > 0);
});

test('a worktree touched recently is assumed to have a live agent in it', () => {
  assert.ok(removalBlockers(clean({ activeRecently: true }), SELF).length > 0);
});

test('tidy never removes the folder it is running from', () => {
  assert.ok(removalBlockers(clean({ dir: SELF }), SELF).length > 0);
});

test('long-lived branch labels are protected from deletion', () => {
  for (const branch of ['main', 'master', 'develop', 'staging']) {
    assert.ok(PROTECTED_BRANCHES.has(branch), `${branch} must be protected`);
  }
  assert.ok(!PROTECTED_BRANCHES.has('agent/whatever'));
});
