import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CODEX_GATEWAY_DOES_NOT_OWN,
  CODEX_GATEWAY_OWNS,
  CODEX_GATEWAY_PACKAGE_NAME,
  CODEX_GATEWAY_PACKAGE_PHASE,
  CODEX_GATEWAY_RELEASE_CHANNEL,
} from '../src/index.js';

test('codex gateway package exposes the migration boundary contract', () => {
  assert.equal(CODEX_GATEWAY_PACKAGE_NAME, '@codexbridge/codex-gateway');
  assert.equal(CODEX_GATEWAY_PACKAGE_PHASE, 'phase-5-internal-package');
  assert.equal(CODEX_GATEWAY_RELEASE_CHANNEL, 'internal-only');
  assert.ok(CODEX_GATEWAY_OWNS.includes('responses-to-chat-conversion'));
  assert.ok(CODEX_GATEWAY_OWNS.includes('local-codex-gateway-server'));
  assert.ok(CODEX_GATEWAY_DOES_NOT_OWN.includes('wechat-transport'));
  assert.ok(CODEX_GATEWAY_DOES_NOT_OWN.includes('assistant-records'));
});

test('codex gateway package metadata stays internal-only while the boundary stabilizes', () => {
  const packageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    private?: boolean;
    exports?: Record<string, unknown>;
    files?: string[];
  };

  assert.equal(packageJson.private, true);
  assert.deepEqual(Object.keys(packageJson.exports ?? {}).sort(), ['.', './package.json']);
  assert.deepEqual(packageJson.files, ['dist', 'README.md']);
});
