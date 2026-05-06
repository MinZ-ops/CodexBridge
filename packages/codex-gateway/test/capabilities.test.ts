import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenAICompatibleExternalModelCatalog,
  getOpenAICompatibleProviderPreset,
  mergeOpenAICompatibleProviderCapabilities,
  OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS,
  resolveOpenAICompatibleProviderCapabilitiesForModel,
  resolveReasoningEffortForProvider,
} from '../src/index.js';

test('capability presets are exported from the package boundary', () => {
  const preset = getOpenAICompatibleProviderPreset('minimax');
  assert.equal(preset.id, 'minimax');
  assert.equal(preset.defaultModel, 'MiniMax-M2.7');
  assert.equal(preset.capabilities?.modelCapabilities?.['MiniMax-M2.7']?.parallelToolCalls, false);
  const qwenRegistration = OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS.find((entry) => entry.presetId === 'qwen');
  assert.equal(qwenRegistration?.envPrefix, 'QWEN');
  assert.equal(qwenRegistration?.alternativeApiKeyEnv, 'DASHSCOPE_API_KEY');
});

test('external model catalogs merge model-level capabilities', () => {
  const catalog = buildOpenAICompatibleExternalModelCatalog({
    raw: {
      qwen: [{
        id: 'qwen-test',
        display_name: 'Qwen Test',
        max_completion_tokens: 4096,
        thinking: {
          min: 128,
          max: 8192,
          zero_allowed: true,
        },
      }],
    },
    defaultModel: 'qwen-test',
    displayName: 'Qwen',
    capabilities: null,
  });

  assert.equal(catalog.catalog.length, 1);
  assert.equal(catalog.catalog[0].displayName, 'Qwen Test');
  assert.deepEqual(catalog.capabilities?.modelCapabilities?.['qwen-test']?.reasoning, {
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high'],
    defaultReasoningEffort: null,
  });
});

test('thinking policy resolves explicit effort through package-local model info', () => {
  const capabilities = mergeOpenAICompatibleProviderCapabilities({
    thinking: {
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    },
  });

  assert.equal(resolveReasoningEffortForProvider({
    providerKind: 'openai-compatible',
    modelInfo: {
      supportedReasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'low',
    },
    requestedEffort: 'high',
    capabilities,
  }), 'high');

  assert.equal(resolveReasoningEffortForProvider({
    providerKind: 'openai-compatible',
    modelInfo: {
      supportedReasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'low',
    },
    requestedEffort: 'xhigh',
    capabilities,
  }), 'low');
});

test('model capability resolution applies model-specific overrides', () => {
  const capabilities = resolveOpenAICompatibleProviderCapabilitiesForModel({
    supportsTools: true,
    modelCapabilities: {
      'text-only-model': {
        tools: false,
        vision: false,
        reasoning: false,
      },
    },
  }, 'text-only-model');

  assert.equal(capabilities?.supportsTools, false);
  assert.equal(capabilities?.multimodal?.supportsImageInput, false);
  assert.equal(capabilities?.thinking?.supportsReasoningEffortSelection, false);
});
