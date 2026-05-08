import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexNativeApiServer } from '../../../src/providers/codex/native_api_server.js';
import { CodexNativeRuntime } from '../../../src/providers/codex/native_runtime.js';

function makeProfile(overrides = {}) {
  return {
    id: 'openai-default',
    providerKind: 'codex',
    displayName: 'Codex OpenAI',
    config: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

test('CodexNativeApiServer exposes /v1/models with runtime metadata', async () => {
  const runtime = new CodexNativeRuntime({
    now: () => 111,
    readAccountIdentity: () => ({
      email: 'native@example.com',
      name: 'Native Runtime',
      authMode: 'chatgpt',
      accountId: 'acc_native',
      plan: 'plus',
      authPath: '/tmp/auth.json',
    }),
  });
  let modelCalls = 0;
  const providerPlugin = {
    async listModels() {
      modelCalls += 1;
      return [{
        id: 'gpt-5.4',
        model: 'gpt-5.4',
        displayName: 'GPT-5.4',
        description: 'Frontier coding model.',
        isDefault: true,
        supportedReasoningEfforts: ['medium', 'high'],
        defaultReasoningEffort: 'medium',
      }];
    },
  } as any;
  const server = new CodexNativeApiServer({
    runtime,
    resolveRuntimeContext: () => ({
      providerProfile: makeProfile(),
      providerPlugin,
    }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/models`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(modelCalls, 1);
    assert.equal(body.object, 'list');
    assert.equal(body.data[0].id, 'gpt-5.4');
    assert.equal(body.data[0].default, true);
    assert.equal(body.meta.native_runtime.ready, true);
    assert.equal(body.meta.native_runtime.account_identity.account_id, 'acc_native');
    assert.equal(body.meta.native_runtime.provider_profile_id, 'openai-default');
  } finally {
    await server.stop();
  }
});

test('CodexNativeApiServer routes /v1/responses through isolated native runtime execution', async () => {
  const calls: Array<{ kind: string; payload: any }> = [];
  const runtime = new CodexNativeRuntime({
    now: () => 222000,
    createSessionId: () => 'session-native-api-1',
    readAccountIdentity: () => ({
      email: 'native@example.com',
      name: 'Native Runtime',
      authMode: 'chatgpt',
      accountId: 'acc_native',
      plan: 'plus',
      authPath: '/tmp/auth.json',
    }),
  });
  const providerPlugin = {
    async listModels() {
      calls.push({ kind: 'listModels', payload: null });
      return [{
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'GPT-5.5',
        description: 'Newest coding model.',
        isDefault: true,
        supportedReasoningEfforts: ['medium', 'high'],
        defaultReasoningEffort: 'medium',
      }];
    },
    async startThread(params: any) {
      calls.push({ kind: 'startThread', payload: params });
      return {
        threadId: 'thread-native-api-1',
        cwd: params.cwd,
        title: params.title,
      };
    },
    async startTurn(params: any) {
      calls.push({ kind: 'startTurn', payload: params });
      return {
        outputText: 'native answer',
        previewText: '',
        threadId: params.bridgeSession.codexThreadId,
        turnId: 'turn-native-api-1',
      };
    },
  } as any;
  const server = new CodexNativeApiServer({
    runtime,
    resolveRuntimeContext: () => ({
      providerProfile: makeProfile(),
      providerPlugin,
    }),
    defaultCwd: '/workspace/default',
    defaultLocale: 'zh-CN',
    createResponseId: () => 'resp_native_api_1',
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.5',
        instructions: 'Be terse.',
        input: [{
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Explain the test.',
          }],
        }],
        reasoning: {
          effort: 'high',
        },
        service_tier: 'flex',
        metadata: {
          cwd: '/tmp/project',
          locale: 'en-US',
          ticket: 'NATIVE-1',
        },
      }),
    });
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.id, 'resp_native_api_1');
    assert.equal(body.object, 'response');
    assert.equal(body.status, 'completed');
    assert.equal(body.model, 'gpt-5.5');
    assert.equal(body.output[0].content[0].text, 'native answer');
    assert.equal(body.native_runtime.thread_id, 'thread-native-api-1');
    assert.equal(body.native_runtime.turn_id, 'turn-native-api-1');
    assert.equal(body.native_runtime.bridge_session_id, 'session-native-api-1');

    assert.equal(calls[0]?.kind, 'listModels');
    assert.equal(calls[1]?.kind, 'startThread');
    assert.equal(calls[1]?.payload.ephemeral, true);
    assert.equal(calls[1]?.payload.cwd, '/tmp/project');
    assert.equal(calls[1]?.payload.metadata.source, 'codex-native-api');

    assert.equal(calls[2]?.kind, 'startTurn');
    assert.equal(calls[2]?.payload.bridgeSession.id, 'session-native-api-1');
    assert.equal(calls[2]?.payload.sessionSettings.model, 'gpt-5.5');
    assert.equal(calls[2]?.payload.sessionSettings.reasoningEffort, 'high');
    assert.equal(calls[2]?.payload.sessionSettings.serviceTier, 'flex');
    assert.equal(calls[2]?.payload.sessionSettings.locale, 'en-US');
    assert.equal(calls[2]?.payload.sessionSettings.metadata.requestMetadata.ticket, 'NATIVE-1');
    assert.equal(calls[2]?.payload.event.platform, 'codex-native-api');
    assert.equal(calls[2]?.payload.event.cwd, '/tmp/project');
    assert.match(calls[2]?.payload.inputText, /System instructions:\nBe terse\./);
    assert.match(calls[2]?.payload.inputText, /Conversation input:\nUSER:\nExplain the test\./);
  } finally {
    await server.stop();
  }
});

test('CodexNativeApiServer rejects continuation and streaming requests before runtime execution', async () => {
  let resolverCalls = 0;
  const server = new CodexNativeApiServer({
    resolveRuntimeContext: () => {
      resolverCalls += 1;
      throw new Error('resolver should not run');
    },
  });
  await server.start();
  try {
    const continuationResponse = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'hello',
        previous_response_id: 'resp_older',
      }),
    });
    const continuationBody = await continuationResponse.json() as any;
    assert.equal(continuationResponse.status, 400);
    assert.equal(continuationBody.error.code, 'continuation_not_supported');

    const streamingResponse = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'hello',
        stream: true,
      }),
    });
    const streamingBody = await streamingResponse.json() as any;
    assert.equal(streamingResponse.status, 400);
    assert.match(streamingBody.error.message, /Streaming is not implemented/);
    assert.equal(resolverCalls, 0);
  } finally {
    await server.stop();
  }
});

test('CodexNativeApiServer enforces optional bearer auth on localhost routes', async () => {
  const runtime = new CodexNativeRuntime({
    now: () => 333,
    readAccountIdentity: () => ({
      email: 'native@example.com',
      name: 'Native Runtime',
      authMode: 'chatgpt',
      accountId: 'acc_native',
      plan: 'plus',
      authPath: '/tmp/auth.json',
    }),
  });
  const providerPlugin = {
    async listModels() {
      return [{
        id: 'gpt-5.4-mini',
        model: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 Mini',
        description: '',
        isDefault: true,
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      }];
    },
  } as any;
  const server = new CodexNativeApiServer({
    runtime,
    resolveRuntimeContext: () => ({
      providerProfile: makeProfile(),
      providerPlugin,
    }),
    authToken: 'native-secret',
  });
  await server.start();
  try {
    const unauthorized = await fetch(`${server.baseUrl}/v1/models`);
    const unauthorizedBody = await unauthorized.json() as any;
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorizedBody.error.code, 'invalid_auth_token');

    const authorized = await fetch(`${server.baseUrl}/v1/models`, {
      headers: {
        Authorization: 'Bearer native-secret',
      },
    });
    const authorizedBody = await authorized.json() as any;
    assert.equal(authorized.status, 200);
    assert.equal(authorizedBody.data[0].id, 'gpt-5.4-mini');
  } finally {
    await server.stop();
  }
});
