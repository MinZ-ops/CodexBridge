import {
  buildCliproxyModelCapabilitiesForEntry,
  buildCliproxyModelCapabilityMap,
  buildCliproxyModelIds,
  findCliproxyModelCatalogEntry,
  type CliproxyModelCategory,
} from './cliproxy_model_catalog.js';
import {
  mergeOpenAICompatibleProviderCapabilities,
  type OpenAICompatibleModelCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';

export type OpenAICompatibleCapabilityPresetId =
  | 'default'
  | 'deepseek'
  | 'minimax'
  | 'qwen'
  | 'openrouter'
  | 'iflow'
  | 'kimi'
  | 'antigravity'
  | 'claude'
  | 'gemini'
  | 'aistudio'
  | 'vertex'
  | 'gemini-cli'
  | 'codex-free'
  | 'codex-team'
  | 'codex-plus'
  | 'codex-pro';

export interface OpenAICompatibleProviderPreset {
  id: OpenAICompatibleCapabilityPresetId;
  displayName: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  modelIds: string[];
  ownedBy: string;
  upstreamChatCompletionsPath: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}

export interface OpenAICompatibleProfilePresetRegistration {
  presetId: OpenAICompatibleCapabilityPresetId;
  envPrefix: string;
  alternativeApiKeyEnv?: string | null;
  alternativeBaseUrlEnv?: string | null;
  alternativeModelEnv?: string | null;
}

const OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES: OpenAICompatibleProviderCapabilities = {
  supportsBuiltinWebSearchTool: false,
  supportsResponsesCompact: false,
  usage: {
    estimateWhenMissing: true,
  },
};

const TEXT_ONLY_MULTIMODAL = {
  supportsImageInput: false,
  supportsFileInput: false,
  unsupportedInputPartStrategy: 'text-placeholder' as const,
};

const PRESETS: Record<OpenAICompatibleCapabilityPresetId, OpenAICompatibleProviderPreset> = {
  default: buildPreset({
    id: 'default',
    displayName: 'OpenAI Compatible',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai-compatible',
    categories: ['codex-pro'],
  }),
  deepseek: buildPreset({
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    ownedBy: 'deepseek',
    categories: ['deepseek-codex'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  minimax: buildPreset({
    id: 'minimax',
    displayName: 'MiniMax',
    apiKeyEnv: 'MINIMAX_API_KEY',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    ownedBy: 'minimax',
    categories: ['minimax-codex'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  qwen: buildPreset({
    id: 'qwen',
    displayName: 'Qwen',
    apiKeyEnv: 'QWEN_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    ownedBy: 'qwen',
    categories: ['qwen'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  openrouter: buildPreset({
    id: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    ownedBy: 'openrouter',
    categories: ['openrouter'],
  }),
  iflow: buildPreset({
    id: 'iflow',
    displayName: 'iFlow',
    apiKeyEnv: 'IFLOW_API_KEY',
    baseUrl: 'https://apis.iflow.cn/v1',
    defaultModel: 'qwen3-coder-plus',
    ownedBy: 'iflow',
    categories: ['iflow'],
    extraCapabilities: {
      multimodal: {
        supportsImageInput: true,
        supportsFileInput: false,
        unsupportedInputPartStrategy: 'text-placeholder',
      },
    },
  }),
  kimi: buildPreset({
    id: 'kimi',
    displayName: 'Kimi',
    apiKeyEnv: 'KIMI_API_KEY',
    baseUrl: 'https://api.kimi.com/coding',
    defaultModel: 'kimi-k2',
    ownedBy: 'moonshot',
    categories: ['kimi'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  antigravity: buildPreset({
    id: 'antigravity',
    displayName: 'Antigravity',
    apiKeyEnv: 'ANTIGRAVITY_API_KEY',
    baseUrl: 'https://cloudcode-pa.googleapis.com',
    defaultModel: 'gemini-3-flash',
    ownedBy: 'antigravity',
    categories: ['antigravity'],
  }),
  claude: buildPreset({
    id: 'claude',
    displayName: 'Claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    ownedBy: 'anthropic',
    categories: ['claude'],
    extraCapabilities: {
      multimodal: {
        supportsImageInput: true,
        supportsFileInput: false,
        unsupportedInputPartStrategy: 'text-placeholder',
      },
    },
  }),
  gemini: buildPreset({
    id: 'gemini',
    displayName: 'Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['gemini'],
  }),
  aistudio: buildPreset({
    id: 'aistudio',
    displayName: 'AI Studio',
    apiKeyEnv: 'AISTUDIO_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['aistudio'],
  }),
  vertex: buildPreset({
    id: 'vertex',
    displayName: 'Vertex',
    apiKeyEnv: 'VERTEX_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['vertex'],
  }),
  'gemini-cli': buildPreset({
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    apiKeyEnv: 'GEMINI_CLI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['gemini-cli'],
  }),
  'codex-free': buildPreset({
    id: 'codex-free',
    displayName: 'Codex Free',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-free'],
  }),
  'codex-team': buildPreset({
    id: 'codex-team',
    displayName: 'Codex Team',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-team'],
  }),
  'codex-plus': buildPreset({
    id: 'codex-plus',
    displayName: 'Codex Plus',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-plus'],
  }),
  'codex-pro': buildPreset({
    id: 'codex-pro',
    displayName: 'Codex Pro',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-pro'],
  }),
};

export const OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS: readonly OpenAICompatibleProfilePresetRegistration[] = [
  {
    presetId: 'deepseek',
    envPrefix: 'DEEPSEEK',
  },
  {
    presetId: 'minimax',
    envPrefix: 'MINIMAX',
  },
  {
    presetId: 'qwen',
    envPrefix: 'QWEN',
    alternativeApiKeyEnv: 'DASHSCOPE_API_KEY',
    alternativeBaseUrlEnv: 'DASHSCOPE_BASE_URL',
    alternativeModelEnv: 'DASHSCOPE_MODEL',
  },
  {
    presetId: 'openrouter',
    envPrefix: 'OPENROUTER',
  },
  {
    presetId: 'kimi',
    envPrefix: 'KIMI',
  },
  {
    presetId: 'gemini',
    envPrefix: 'GEMINI',
  },
  {
    presetId: 'iflow',
    envPrefix: 'IFLOW',
  },
] as const;

export function getOpenAICompatibleProviderPreset(id: string | null | undefined): OpenAICompatibleProviderPreset {
  const normalized = normalizePresetId(id);
  return PRESETS[normalized] ?? PRESETS.default;
}

export function buildOpenAICompatibleModelCatalog({
  defaultModel,
  modelIds,
  displayName,
  capabilities,
}: {
  defaultModel: string;
  modelIds: string[];
  displayName: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}) {
  const uniqueIds = [...new Set([defaultModel, ...modelIds].map((entry) => normalizeString(entry)).filter(Boolean))];
  return uniqueIds.map((id) => {
    const cliproxyEntry = findCliproxyModelCatalogEntry(id);
    const modelCapabilities = capabilities?.modelCapabilities?.[id]
      ?? (cliproxyEntry ? buildCliproxyModelCapabilitiesForEntry(cliproxyEntry) : undefined);
    const reasoning = modelCapabilities?.reasoning && typeof modelCapabilities.reasoning === 'object'
      ? modelCapabilities.reasoning
      : null;
    return {
      id,
      model: id,
      displayName: cliproxyEntry?.displayName ?? id,
      description: cliproxyEntry?.description ?? `${displayName} model through the generic OpenAI-compatible Responses adapter.`,
      isDefault: id === defaultModel,
      supportedReasoningEfforts: reasoning?.supportedReasoningEfforts ?? [],
      defaultReasoningEffort: reasoning?.defaultReasoningEffort ?? null,
      capabilities: modelCapabilities,
    };
  });
}

export function buildOpenAICompatibleExternalModelCatalog({
  raw,
  defaultModel,
  displayName,
  capabilities,
}: {
  raw: unknown;
  defaultModel: string;
  displayName: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}): {
  catalog: any[];
  capabilities: OpenAICompatibleProviderCapabilities | null;
} {
  const entries = extractExternalModelCatalogEntries(raw);
  if (entries.length === 0) {
    return {
      catalog: [],
      capabilities: mergeOpenAICompatibleProviderCapabilities(capabilities),
    };
  }
  const seen = new Set<string>();
  const modelCapabilities: Record<string, OpenAICompatibleModelCapabilities> = {};
  const catalog: any[] = [];
  for (const rawEntry of entries) {
    const id = normalizeString(rawEntry.id) || normalizeString(rawEntry.model) || normalizeString(rawEntry.slug);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const cliproxyEntry = findCliproxyModelCatalogEntry(id);
    const capabilitiesForModel = rawEntry.capabilities && typeof rawEntry.capabilities === 'object'
      ? rawEntry.capabilities as OpenAICompatibleModelCapabilities
      : cliproxyEntry
        ? buildCliproxyModelCapabilitiesForEntry(cliproxyEntry)
        : buildCapabilitiesFromExternalModelEntry(rawEntry);
    if (capabilitiesForModel) {
      modelCapabilities[id] = capabilitiesForModel;
    }
    const reasoning = capabilitiesForModel?.reasoning && typeof capabilitiesForModel.reasoning === 'object'
      ? capabilitiesForModel.reasoning
      : null;
    catalog.push({
      ...rawEntry,
      id,
      model: normalizeString(rawEntry.model) || id,
      displayName: normalizeString(rawEntry.displayName)
        || normalizeString(rawEntry.display_name)
        || cliproxyEntry?.displayName
        || id,
      description: normalizeString(rawEntry.description)
        || cliproxyEntry?.description
        || `${displayName} model through the generic OpenAI-compatible Responses adapter.`,
      isDefault: id === defaultModel,
      supportedReasoningEfforts: Array.isArray(rawEntry.supportedReasoningEfforts)
        ? rawEntry.supportedReasoningEfforts.map((entry: unknown) => normalizeString(entry)).filter(Boolean)
        : reasoning?.supportedReasoningEfforts ?? [],
      defaultReasoningEffort: normalizeString(rawEntry.defaultReasoningEffort)
        || reasoning?.defaultReasoningEffort
        || null,
      capabilities: capabilitiesForModel,
    });
  }
  return {
    catalog,
    capabilities: mergeOpenAICompatibleProviderCapabilities(
      capabilities,
      { modelCapabilities },
    ),
  };
}

function buildPreset({
  id,
  displayName,
  apiKeyEnv,
  baseUrl,
  defaultModel,
  ownedBy,
  categories,
  extraCapabilities = null,
}: {
  id: OpenAICompatibleCapabilityPresetId;
  displayName: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  ownedBy: string;
  categories: CliproxyModelCategory[];
  extraCapabilities?: OpenAICompatibleProviderCapabilities | null;
}): OpenAICompatibleProviderPreset {
  const modelIds = buildCliproxyModelIds(categories);
  const capabilities = mergeOpenAICompatibleProviderCapabilities(
    OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
    {
      modelCapabilities: buildCliproxyModelCapabilityMap(categories),
    },
    extraCapabilities,
  );
  return {
    id,
    displayName,
    apiKeyEnv,
    baseUrl,
    defaultModel,
    modelIds,
    ownedBy,
    upstreamChatCompletionsPath: '/chat/completions',
    capabilities,
  };
}

function extractExternalModelCatalogEntries(raw: unknown): any[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => entry && typeof entry === 'object');
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const entries: any[] = [];
  for (const [category, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        entries.push({
          ...(entry as Record<string, unknown>),
          category: normalizeString((entry as Record<string, unknown>).category) || category,
        });
      }
    }
  }
  return entries;
}

function buildCapabilitiesFromExternalModelEntry(entry: Record<string, any>): OpenAICompatibleModelCapabilities {
  const id = normalizeString(entry.id).toLowerCase();
  const category = normalizeString(entry.category).toLowerCase();
  const supportedParameters = Array.isArray(entry.supportedParameters)
    ? entry.supportedParameters
    : Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : null;
  const hasSupportedParameters = Array.isArray(supportedParameters);
  const maxOutputTokens = normalizePositiveNumber(entry.maxOutputTokens)
    ?? normalizePositiveNumber(entry.max_completion_tokens)
    ?? normalizePositiveNumber(entry.outputTokenLimit);
  const reasoningLevels = inferExternalReasoningLevels(entry.thinking);
  return {
    tools: hasSupportedParameters ? supportedParameters.includes('tools') : !isExternalNonChatModel(id),
    vision: inferExternalVisionSupport(id, category, entry),
    fileInput: false,
    jsonSchema: !hasSupportedParameters || supportedParameters.includes('response_format'),
    reasoning: reasoningLevels.length > 0
      ? {
        supportedReasoningEfforts: reasoningLevels,
        defaultReasoningEffort: null,
      }
      : false,
    thinking: reasoningLevels.length > 0
      ? {
        supportsReasoningEffortSelection: true,
        supportedReasoningEfforts: reasoningLevels,
        defaultReasoningEffort: null,
        stripFields: ['thinking'],
        mode: 'reasoning_effort',
      }
      : {
        supportsReasoningEffortSelection: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        stripFields: ['reasoning_effort', 'thinking'],
        mode: 'boolean',
        booleanField: null,
      },
    webSearch: false,
    parallelToolCalls: !id.startsWith('minimax'),
    maxOutputTokens: maxOutputTokens ?? undefined,
  };
}

function inferExternalReasoningLevels(thinking: unknown): string[] {
  if (!thinking || typeof thinking !== 'object') {
    return [];
  }
  const record = thinking as Record<string, unknown>;
  if (Array.isArray(record.levels)) {
    return [...new Set(record.levels.map((entry) => normalizeString(entry)).filter(Boolean))];
  }
  if (
    normalizePositiveNumber(record.min) !== null
    || normalizePositiveNumber(record.max) !== null
    || Boolean(record.dynamic_allowed)
    || Boolean(record.dynamicAllowed)
  ) {
    const levels = ['low', 'medium', 'high'];
    if (record.zero_allowed === true || record.zeroAllowed === true) {
      levels.unshift('none');
    }
    return levels;
  }
  return [];
}

function inferExternalVisionSupport(id: string, category: string, entry: Record<string, any>): boolean {
  if (isExternalNonChatModel(id)) {
    return false;
  }
  if (entry.vision !== undefined) {
    return Boolean(entry.vision);
  }
  return id.includes('vl')
    || id.includes('image')
    || category === 'gemini'
    || category === 'vertex'
    || category === 'gemini-cli'
    || category === 'aistudio'
    || category === 'antigravity';
}

function isExternalNonChatModel(id: string): boolean {
  return id.includes('embedding') || id.startsWith('imagen-');
}

function normalizePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizePresetId(id: string | null | undefined): OpenAICompatibleCapabilityPresetId {
  const normalized = normalizeString(id).toLowerCase();
  switch (normalized) {
    case 'deepseek':
    case 'minimax':
    case 'qwen':
    case 'openrouter':
    case 'iflow':
    case 'kimi':
    case 'antigravity':
    case 'claude':
    case 'gemini':
    case 'aistudio':
    case 'vertex':
    case 'gemini-cli':
    case 'codex-free':
    case 'codex-team':
    case 'codex-plus':
    case 'codex-pro':
      return normalized;
    default:
      return 'default';
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
