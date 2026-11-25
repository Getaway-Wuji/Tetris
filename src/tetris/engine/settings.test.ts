import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySettings, BINDINGS_VERSION, defaultBindings, readSettings } from './settings';

test('moves the legacy down key to hard drop while retaining all custom hard-drop keys', () => {
  const bindings = {
    ...defaultBindings(),
    left: ['KeyS'],
    softDrop: ['ArrowDown'],
    hardDrop: ['Space', 'KeyD', 'KeyF'],
  };
  const settings = readSettings({ bindings, volume: 0.25 }, false);
  assert.deepEqual(settings.bindings.hardDrop, ['ArrowDown', 'Space', 'KeyD', 'KeyF']);
  assert.deepEqual(settings.bindings.left, ['KeyS']);
  assert.ok(!settings.bindings.softDrop.includes('KeyS'));
  assert.equal(settings.volume, 0.25);
  assert.deepEqual(readSettings(settings, false).bindings, settings.bindings);
});

test('retains intentional custom key assignments saved after the default change', () => {
  const bindings = { ...defaultBindings(), softDrop: ['ArrowDown'], hardDrop: ['Space'] };
  const settings = readSettings({ bindings, bindingsVersion: BINDINGS_VERSION }, false);
  assert.deepEqual(settings.bindings, bindings);
  assert.deepEqual(applySettings(settings, { quality: 'low' }).bindings, bindings);
});
