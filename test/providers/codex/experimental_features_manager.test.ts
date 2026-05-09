import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexExperimentalFeaturesManager,
  getPublicCodexExperimentalFeatures,
  isVisibleCodexExperimentalFeature,
  parseCodexFeaturesListOutput,
} from '../../../src/providers/codex/experimental_features_manager.js';

test('parseCodexFeaturesListOutput parses maturity labels with spaces', () => {
  const output = [
    'memories                            experimental       false',
    'goals                               under development  false',
    'image_generation                    stable             true',
    'web_search_cached                   deprecated         false',
  ].join('\n');

  const features = parseCodexFeaturesListOutput(output);
  assert.deepEqual(features, [
    { name: 'memories', maturity: 'experimental', enabled: false },
    { name: 'goals', maturity: 'under development', enabled: false },
    { name: 'image_generation', maturity: 'stable', enabled: true },
    { name: 'web_search_cached', maturity: 'deprecated', enabled: false },
  ]);
  assert.equal(isVisibleCodexExperimentalFeature(features[0]), true);
  assert.equal(isVisibleCodexExperimentalFeature(features[3]), false);
});

test('getPublicCodexExperimentalFeatures keeps the official experimental menu order', () => {
  const features = parseCodexFeaturesListOutput([
    'image_generation                    stable             true',
    'goals                               under development  false',
    'prevent_idle_sleep                  experimental       false',
    'memories                            experimental       false',
    'terminal_resize_reflow              experimental       true',
    'external_migration                  experimental       false',
  ].join('\n'));

  assert.deepEqual(
    getPublicCodexExperimentalFeatures(features).map((feature) => feature.name),
    [
      'terminal_resize_reflow',
      'memories',
      'external_migration',
      'goals',
      'prevent_idle_sleep',
    ],
  );
});

test('CodexExperimentalFeaturesManager delegates list/enable/disable to codex features commands', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const manager = new CodexExperimentalFeaturesManager({
    execFileSyncImpl: ((command: string, args: string[]) => {
      calls.push({ command, args });
      if (args[0] === 'features' && args[1] === 'list') {
        return 'memories  experimental  false\n';
      }
      return '';
    }) as any,
  });

  const features = await manager.listFeatures({ codexCliBin: '/opt/codex/bin/codex' });
  await manager.enableFeature('memories', { codexCliBin: '/opt/codex/bin/codex' });
  await manager.disableFeature('memories', { codexCliBin: '/opt/codex/bin/codex' });

  assert.deepEqual(features, [
    { name: 'memories', maturity: 'experimental', enabled: false },
  ]);
  assert.deepEqual(calls, [
    { command: '/opt/codex/bin/codex', args: ['features', 'list'] },
    { command: '/opt/codex/bin/codex', args: ['features', 'enable', 'memories'] },
    { command: '/opt/codex/bin/codex', args: ['features', 'disable', 'memories'] },
  ]);
});
