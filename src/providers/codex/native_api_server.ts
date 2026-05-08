import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  CodexNativeRuntime,
  type CodexNativeRuntimeReadiness,
  type CodexNativeRuntimeTurnResult,
  type CodexNativeRuntimeTurnStartedMeta,
} from './native_runtime.js';
import {
  InMemoryCodexNativeApiContinuationRegistry,
  type CodexNativeApiContinuationEntry,
  type CodexNativeApiContinuationRegistryDescriptor,
  type CodexNativeApiContinuationLookupResult,
  type CodexNativeApiContinuationRegistry,
} from './native_api_continuation_registry.js';
import type {
  ProviderModelInfo,
  ProviderPluginContract,
  ProviderProfile,
  ProviderTurnProgress,
} from '../../types/provider.js';

type JsonRecord = Record<string, any>;
type AuthPathOrOptions = string | { authPath?: string; env?: NodeJS.ProcessEnv };

export interface CodexNativeApiRuntimeContext {
  providerProfile: ProviderProfile;
  providerPlugin: ProviderPluginContract | null | undefined;
  authPathOrOptions?: AuthPathOrOptions;
}

export interface CodexNativeApiServerOptions {
  runtime?: CodexNativeRuntime;
  resolveRuntimeContext: () => CodexNativeApiRuntimeContext | Promise<CodexNativeApiRuntimeContext>;
  host?: string;
  port?: number;
  authToken?: string | null;
  defaultModel?: string | null;
  defaultCwd?: string | null;
  defaultLocale?: string | null;
  requestTitlePrefix?: string | null;
  maxBodyBytes?: number;
  continuationRegistry?: CodexNativeApiContinuationRegistry;
  continuationTtlMs?: number;
  now?: () => number;
  createResponseId?: () => string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TITLE_PREFIX = 'Codex Native API';
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

interface ResponsesStreamReasoningState {
  id: string;
  outputIndex: number;
  text: string;
  added: boolean;
  partAdded: boolean;
  done: boolean;
}

interface ResponsesStreamMessageState {
  id: string;
  outputIndex: number;
  text: string;
  added: boolean;
  contentAdded: boolean;
  done: boolean;
}

interface ResponsesStreamState {
  responseId: string;
  createdAt: number;
  request: JsonRecord;
  responseModel: string | null;
  initialNativeRuntime: JsonRecord;
  output: JsonRecord[];
  reasoning: ResponsesStreamReasoningState | null;
  message: ResponsesStreamMessageState | null;
  createdEmitted: boolean;
  terminalEmitted: boolean;
  nextOutputIndex: number;
  sequence: number;
}

export class CodexNativeApiServer {
  private readonly runtime: CodexNativeRuntime;

  private readonly resolveRuntimeContext: () => CodexNativeApiRuntimeContext | Promise<CodexNativeApiRuntimeContext>;

  private readonly host: string;

  private readonly requestedPort: number;

  private readonly authToken: string | null;

  private readonly defaultModel: string | null;

  private readonly defaultCwd: string | null;

  private readonly defaultLocale: string | null;

  private readonly requestTitlePrefix: string;

  private readonly maxBodyBytes: number;

  private readonly continuationRegistry: CodexNativeApiContinuationRegistry;

  private readonly now: () => number;

  private readonly createResponseId: () => string;

  private server: http.Server | null;

  private startedUrl: string | null;

  constructor({
    runtime = new CodexNativeRuntime(),
    resolveRuntimeContext,
    host = DEFAULT_HOST,
    port = 0,
    authToken = null,
    defaultModel = null,
    defaultCwd = null,
    defaultLocale = null,
    requestTitlePrefix = DEFAULT_TITLE_PREFIX,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    continuationRegistry = null,
    continuationTtlMs,
    now = () => Date.now(),
    createResponseId = () => `resp_${crypto.randomUUID()}`,
  }: CodexNativeApiServerOptions) {
    if (typeof resolveRuntimeContext !== 'function') {
      throw new Error('Codex native API server requires a runtime context resolver.');
    }
    this.runtime = runtime;
    this.resolveRuntimeContext = resolveRuntimeContext;
    this.host = normalizeString(host) || DEFAULT_HOST;
    this.requestedPort = Number.isFinite(port) ? Number(port) : 0;
    this.authToken = normalizeString(authToken) || null;
    this.defaultModel = normalizeString(defaultModel) || null;
    this.defaultCwd = normalizeNullableString(defaultCwd);
    this.defaultLocale = normalizeNullableString(defaultLocale);
    this.requestTitlePrefix = normalizeString(requestTitlePrefix) || DEFAULT_TITLE_PREFIX;
    this.maxBodyBytes = Number.isFinite(maxBodyBytes) && Number(maxBodyBytes) > 0
      ? Number(maxBodyBytes)
      : DEFAULT_MAX_BODY_BYTES;
    this.now = now;
    this.continuationRegistry = continuationRegistry ?? new InMemoryCodexNativeApiContinuationRegistry({
      now,
      ttlMs: continuationTtlMs,
    });
    this.createResponseId = createResponseId;
    this.server = null;
    this.startedUrl = null;
  }

  get baseUrl(): string {
    if (!this.startedUrl) {
      throw new Error('Codex native API server has not been started.');
    }
    return this.startedUrl;
  }

  async start(): Promise<void> {
    if (this.server && this.startedUrl) {
      return;
    }
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        writeJson(response, 500, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'server_error',
          },
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        const address = this.server?.address();
        const port = typeof address === 'object' && address ? address.port : this.requestedPort;
        this.startedUrl = `http://${this.host}:${port}`;
        resolve();
      };
      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(this.requestedPort, this.host);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.startedUrl = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }).catch(() => {});
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/v1/') && !this.authorize(request, response)) {
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      await this.handleHealth(response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      await this.handleModels(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/responses') {
      let body: unknown;
      try {
        body = await readJsonBody(request, this.maxBodyBytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.startsWith('Request body exceeded ') ? 413 : 400;
        writeJson(response, status, {
          error: {
            message,
            type: 'invalid_request_error',
          },
        });
        return;
      }
      await this.handleResponses(body, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/responses/compact') {
      writeJson(response, 501, {
        error: {
          message: 'Compact responses are not implemented in the native API shell yet.',
          type: 'not_implemented_error',
        },
      });
      return;
    }
    writeJson(response, 404, {
      error: {
        message: `Unsupported native API route: ${request.method} ${url.pathname}`,
        type: 'not_found',
      },
    });
  }

  private authorize(request: IncomingMessage, response: ServerResponse): boolean {
    if (!this.authToken) {
      return true;
    }
    const rawAuthorization = normalizeString(request.headers.authorization);
    if (rawAuthorization === `Bearer ${this.authToken}`) {
      return true;
    }
    writeJson(response, 401, {
      error: {
        message: 'Missing or invalid local native API bearer token.',
        type: 'authentication_error',
        code: 'invalid_auth_token',
      },
    });
    return false;
  }

  private async handleHealth(response: ServerResponse): Promise<void> {
    const context = await this.resolveRuntimeContext();
    const readiness = await this.runtime.checkReadiness({
      providerProfile: context.providerProfile,
      providerPlugin: context.providerPlugin,
      authPathOrOptions: context.authPathOrOptions ?? {},
    });
    const ready = readiness.ready && readiness.runtimeReachable;
    writeJson(response, ready ? 200 : 503, {
      object: 'health.check',
      status: ready ? 'ok' : (readiness.runtimeReachable ? 'degraded' : 'unavailable'),
      localhost_only: true,
      route_capabilities: {
        models: {
          get: true,
        },
        responses: {
          create: true,
          continuation: true,
          stream: true,
          compact: false,
        },
        chat_completions: {
          create: false,
        },
      },
      continuation_registry: serializeContinuationRegistryDescriptor(this.continuationRegistry.describe()),
      native_runtime: buildRuntimeMetadata({
        providerProfile: context.providerProfile,
        readiness,
      }),
    });
  }

  private async handleModels(response: ServerResponse): Promise<void> {
    const context = await this.resolveRuntimeContext();
    const inspected = await this.inspectModels(context);
    if (!inspected.models) {
      writeJson(response, 503, {
        error: {
          message: inspected.readiness.errorMessage || 'Codex native runtime is unavailable.',
          type: 'service_unavailable_error',
          code: 'native_runtime_unavailable',
        },
        native_runtime: buildRuntimeMetadata({
          providerProfile: context.providerProfile,
          readiness: inspected.readiness,
        }),
      });
      return;
    }
    writeJson(response, 200, {
      object: 'list',
      data: inspected.models.map((model) => serializeModel(model, context.providerProfile)),
      models: inspected.models.map((model) => serializeModel(model, context.providerProfile)),
      meta: {
        localhost_only: true,
        continuation_registry: serializeContinuationRegistryDescriptor(this.continuationRegistry.describe()),
        native_runtime: buildRuntimeMetadata({
          providerProfile: context.providerProfile,
          readiness: inspected.readiness,
        }),
      },
    });
  }

  private async handleResponses(body: unknown, response: ServerResponse): Promise<void> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      writeJson(response, 400, {
        error: {
          message: 'Responses requests require a JSON object body.',
          type: 'invalid_request_error',
        },
      });
      return;
    }
    const requestBody = body as JsonRecord;
    const stream = Boolean(requestBody.stream);
    const previousResponseId = normalizeString(requestBody.previous_response_id) || null;
    const prompt = buildPromptFromResponsesRequest(requestBody);
    if (!prompt) {
      writeJson(response, 400, {
        error: {
          message: 'Responses requests require textual input or instructions.',
          type: 'invalid_request_error',
        },
      });
      return;
    }
    const continuationLookup = previousResponseId
      ? this.continuationRegistry.lookup(previousResponseId)
      : null;
    if (previousResponseId && continuationLookup?.status !== 'found') {
      const error = buildContinuationLookupError(previousResponseId, continuationLookup);
      writeJson(response, error.status, {
        error: {
          message: error.message,
          type: 'invalid_request_error',
          code: error.code,
        },
        continuation_registry: serializeContinuationRegistryDescriptor(this.continuationRegistry.describe()),
      });
      return;
    }
    const continuationEntry = continuationLookup?.entry ?? null;
    const context = await this.resolveRuntimeContext();
    const readiness = await this.runtime.checkReadiness({
      providerProfile: context.providerProfile,
      providerPlugin: context.providerPlugin,
      authPathOrOptions: context.authPathOrOptions ?? {},
    });
    if (!readiness.ready || !readiness.runtimeReachable || !context.providerPlugin) {
      writeJson(response, 503, {
        error: {
          message: readiness.errorMessage || 'Codex native runtime is unavailable.',
          type: 'service_unavailable_error',
          code: 'native_runtime_unavailable',
        },
        native_runtime: buildRuntimeMetadata({
          providerProfile: context.providerProfile,
          readiness,
        }),
      });
      return;
    }
    if (continuationEntry) {
      const affinityError = buildContinuationAffinityError({
        continuation: continuationEntry,
        providerProfile: context.providerProfile,
        readiness,
      });
      if (affinityError) {
        writeJson(response, affinityError.status, {
          error: {
            message: affinityError.message,
            type: 'conflict_error',
            code: affinityError.code,
          },
          native_runtime: buildRuntimeMetadata({
            providerProfile: context.providerProfile,
            readiness,
            threadId: continuationEntry.nativeThreadId,
            turnId: continuationEntry.nativeTurnId,
            bridgeSessionId: continuationEntry.bridgeSession.id,
          }),
        });
        return;
      }
    }
    const responseId = this.createResponseId();
    const startedAt = this.now();
    const createdAt = Math.floor(startedAt / 1000);
    const requestMetadata = normalizeRecord(requestBody.metadata);
    const requestedModel = normalizeString(requestBody.model) || null;
    const effectiveModel = requestedModel || continuationEntry?.model || this.defaultModel;
    const locale = normalizeNullableString(requestMetadata?.locale) || this.defaultLocale;
    const requestedCwd = normalizeNullableString(requestMetadata?.cwd);
    const effectiveCwd = continuationEntry ? continuationEntry.bridgeSession.cwd : (requestedCwd || this.defaultCwd);
    const reasoningEffort = normalizeNullableString(requestBody.reasoning?.effort);
    const serviceTier = normalizeNullableString(requestBody.service_tier);
    const internalEventMetadata = extractInternalCodexbridgeEventMetadata(requestMetadata);
    const internalThreadMetadata = extractInternalCodexbridgeThreadMetadata(requestMetadata);
    const internalTaskClass = extractInternalCodexbridgeTaskClass(requestMetadata);

    if (stream) {
      await this.handleStreamingResponses({
        response,
        request: requestBody,
        responseId,
        previousResponseId,
        startedAt,
        createdAt,
        context,
        readiness,
        continuationEntry,
        prompt,
        locale,
        requestMetadata,
        internalEventMetadata,
        internalThreadMetadata,
        internalTaskClass,
        effectiveModel,
        effectiveCwd,
        reasoningEffort,
        serviceTier,
      });
      return;
    }

    try {
      const execution = await this.executeResponsesTurn({
        context,
        continuationEntry,
        responseId,
        previousResponseId,
        prompt,
        locale,
        requestMetadata,
        internalEventMetadata,
        internalThreadMetadata,
        internalTaskClass,
        effectiveModel,
        effectiveCwd,
        reasoningEffort,
        serviceTier,
        requestUser: normalizeNullableString(requestBody.user),
      });
      const outputText = normalizeString(execution.result.outputText);
      const previewText = normalizeString(execution.result.previewText);
      const effectiveText = outputText || previewText;
      if (!effectiveText) {
        writeJson(response, 502, {
          error: {
            message: normalizeString(execution.result.errorMessage) || 'Codex native runtime returned no response text.',
            type: 'native_runtime_error',
          },
          native_runtime: buildRuntimeMetadata({
            providerProfile: context.providerProfile,
            readiness,
            threadId: execution.result.threadId ?? execution.session.codexThreadId,
            turnId: execution.result.turnId ?? null,
            bridgeSessionId: execution.session.id,
          }),
        });
        return;
      }
      if (previousResponseId) {
        this.continuationRegistry.touch(previousResponseId);
      }
      this.continuationRegistry.store({
        responseId,
        previousResponseId,
        providerProfileId: context.providerProfile.id,
        bridgeSession: execution.session,
        nativeThreadId: execution.result.threadId ?? execution.session.codexThreadId,
        nativeTurnId: execution.result.turnId ?? null,
        activeAccountId: readiness.accountIdentity?.accountId ?? null,
        model: effectiveModel,
        routeKind: 'responses',
        startedAt,
        lastUsedAt: startedAt,
      });
      writeJson(response, 200, buildResponsesObject({
        request: requestBody,
        responseId,
        createdAt,
        responseModel: effectiveModel,
        status: outputText ? 'completed' : 'incomplete',
        outputText: effectiveText,
        incompleteDetails: outputText ? null : {
          reason: 'native_runtime_partial',
        },
        nativeRuntime: buildRuntimeMetadata({
          providerProfile: context.providerProfile,
          readiness,
          threadId: execution.result.threadId ?? execution.session.codexThreadId,
          turnId: execution.result.turnId ?? null,
          bridgeSessionId: execution.session.id,
        }),
      }));
    } catch (error) {
      writeJson(response, 502, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: 'native_runtime_error',
        },
        native_runtime: buildRuntimeMetadata({
          providerProfile: context.providerProfile,
          readiness,
        }),
      });
    }
  }

  private async executeResponsesTurn({
    context,
    continuationEntry,
    responseId,
    previousResponseId,
    prompt,
    locale,
    requestMetadata,
    internalEventMetadata,
    internalThreadMetadata,
    internalTaskClass,
    effectiveModel,
    effectiveCwd,
    reasoningEffort,
    serviceTier,
    requestUser = null,
    onProgress = null,
    onTurnStarted = null,
  }: {
    context: CodexNativeApiRuntimeContext;
    continuationEntry: CodexNativeApiContinuationEntry | null;
    responseId: string;
    previousResponseId: string | null;
    prompt: string;
    locale: string | null;
    requestMetadata: JsonRecord | null;
    internalEventMetadata: JsonRecord | undefined;
    internalThreadMetadata: JsonRecord | null;
    internalTaskClass: string | null;
    effectiveModel: string | null;
    effectiveCwd: string | null;
    reasoningEffort: string | null;
    serviceTier: string | null;
    requestUser?: string | null;
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: CodexNativeRuntimeTurnStartedMeta) => Promise<void> | void) | null;
  }): Promise<CodexNativeRuntimeTurnResult> {
    return continuationEntry
      ? this.runtime.continueIsolatedTurn({
        providerProfile: context.providerProfile,
        providerPlugin: context.providerPlugin!,
        bridgeSession: continuationEntry.bridgeSession,
        model: effectiveModel,
        reasoningEffort,
        serviceTier,
        onProgress,
        onTurnStarted,
        prepareTurn: (session) => ({
          inputText: prompt,
          locale,
          metadata: {
            source: 'codex-native-api',
            responseId,
            previousResponseId,
            requestMetadata: requestMetadata ?? {},
          },
          event: {
            platform: 'codex-native-api',
            externalScopeId: responseId,
            text: prompt,
            cwd: session.cwd,
            locale,
            attachments: [],
            metadata: internalEventMetadata,
          },
        }),
      })
      : this.runtime.runIsolatedTurn({
        providerProfile: context.providerProfile,
        providerPlugin: context.providerPlugin!,
        cwd: effectiveCwd,
        title: deriveRequestTitle(this.requestTitlePrefix, prompt),
        metadata: {
          ...(internalThreadMetadata ?? {}),
          source: 'codex-native-api',
          route: '/v1/responses',
          responseId,
          user: requestUser,
          sideTaskClass: internalTaskClass,
        },
        model: effectiveModel,
        reasoningEffort,
        serviceTier,
        onProgress,
        onTurnStarted,
        prepareTurn: (session) => ({
          inputText: prompt,
          locale,
          metadata: {
            source: 'codex-native-api',
            responseId,
            requestMetadata: requestMetadata ?? {},
          },
          event: {
            platform: 'codex-native-api',
            externalScopeId: responseId,
            text: prompt,
            cwd: session.cwd,
            locale,
            attachments: [],
            metadata: internalEventMetadata,
          },
        }),
      });
  }

  private async handleStreamingResponses({
    response,
    request,
    responseId,
    previousResponseId,
    startedAt,
    createdAt,
    context,
    readiness,
    continuationEntry,
    prompt,
    locale,
    requestMetadata,
    internalEventMetadata,
    internalThreadMetadata,
    internalTaskClass,
    effectiveModel,
    effectiveCwd,
    reasoningEffort,
    serviceTier,
  }: {
    response: ServerResponse;
    request: JsonRecord;
    responseId: string;
    previousResponseId: string | null;
    startedAt: number;
    createdAt: number;
    context: CodexNativeApiRuntimeContext;
    readiness: CodexNativeRuntimeReadiness;
    continuationEntry: CodexNativeApiContinuationEntry | null;
    prompt: string;
    locale: string | null;
    requestMetadata: JsonRecord | null;
    internalEventMetadata: JsonRecord | undefined;
    internalThreadMetadata: JsonRecord | null;
    internalTaskClass: string | null;
    effectiveModel: string | null;
    effectiveCwd: string | null;
    reasoningEffort: string | null;
    serviceTier: string | null;
  }): Promise<void> {
    const initialNativeRuntime = buildRuntimeMetadata({
      providerProfile: context.providerProfile,
      readiness,
      threadId: continuationEntry?.nativeThreadId ?? null,
      turnId: continuationEntry?.nativeTurnId ?? null,
      bridgeSessionId: continuationEntry?.bridgeSession.id ?? null,
    });
    const streamState = createResponsesStreamState({
      request,
      responseId,
      createdAt,
      responseModel: effectiveModel,
      nativeRuntime: initialNativeRuntime,
    });
    let latestTurnMeta: {
      threadId: string | null;
      turnId: string | null;
      bridgeSessionId: string | null;
    } = {
      threadId: continuationEntry?.nativeThreadId ?? null,
      turnId: continuationEntry?.nativeTurnId ?? null,
      bridgeSessionId: continuationEntry?.bridgeSession.id ?? null,
    };

    startSse(response);
    const flushEvents = (events: JsonRecord[]) => {
      for (const event of events) {
        writeSseEvent(response, event);
      }
    };

    try {
      const execution = await this.executeResponsesTurn({
        context,
        continuationEntry,
        responseId,
        previousResponseId,
        prompt,
        locale,
        requestMetadata,
        internalEventMetadata,
        internalThreadMetadata,
        internalTaskClass,
        effectiveModel,
        effectiveCwd,
        reasoningEffort,
        serviceTier,
        requestUser: normalizeNullableString(request.user),
        onTurnStarted: (meta) => {
          latestTurnMeta = {
            threadId: meta.threadId,
            turnId: meta.turnId,
            bridgeSessionId: meta.bridgeSessionId,
          };
        },
        onProgress: (progress) => {
          flushEvents(appendResponsesStreamProgress(streamState, progress));
        },
      });
      const outputText = rawString(execution.result.outputText);
      const previewText = rawString(execution.result.previewText);
      const effectiveText = outputText || previewText;
      const nativeRuntime = buildRuntimeMetadata({
        providerProfile: context.providerProfile,
        readiness,
        threadId: execution.result.threadId ?? execution.session.codexThreadId,
        turnId: execution.result.turnId ?? latestTurnMeta.turnId,
        bridgeSessionId: execution.session.id,
      });
      latestTurnMeta = {
        threadId: execution.result.threadId ?? execution.session.codexThreadId,
        turnId: execution.result.turnId ?? latestTurnMeta.turnId,
        bridgeSessionId: execution.session.id,
      };
      if (!effectiveText) {
        flushEvents(failResponsesStreamState(streamState, {
          message: normalizeString(execution.result.errorMessage) || 'Codex native runtime returned no response text.',
          type: 'native_runtime_error',
        }, nativeRuntime));
        finishSse(response);
        return;
      }
      flushEvents(syncResponsesStreamMessageToTerminalText(streamState, effectiveText));
      if (previousResponseId) {
        this.continuationRegistry.touch(previousResponseId);
      }
      this.continuationRegistry.store({
        responseId,
        previousResponseId,
        providerProfileId: context.providerProfile.id,
        bridgeSession: execution.session,
        nativeThreadId: execution.result.threadId ?? execution.session.codexThreadId,
        nativeTurnId: execution.result.turnId ?? null,
        activeAccountId: readiness.accountIdentity?.accountId ?? null,
        model: effectiveModel,
        routeKind: 'responses',
        startedAt,
        lastUsedAt: startedAt,
      });
      flushEvents(finishResponsesStreamState(streamState, {
        status: outputText ? 'completed' : 'incomplete',
        incompleteDetails: outputText ? null : {
          reason: 'native_runtime_partial',
        },
        nativeRuntime,
      }));
      finishSse(response);
    } catch (error) {
      const nativeRuntime = buildRuntimeMetadata({
        providerProfile: context.providerProfile,
        readiness,
        threadId: latestTurnMeta.threadId,
        turnId: latestTurnMeta.turnId,
        bridgeSessionId: latestTurnMeta.bridgeSessionId,
      });
      flushEvents(failResponsesStreamState(streamState, {
        message: error instanceof Error ? error.message : String(error),
        type: 'native_runtime_error',
      }, nativeRuntime));
      finishSse(response);
    }
  }

  private async inspectModels(
    context: CodexNativeApiRuntimeContext,
  ): Promise<{
    models: ProviderModelInfo[] | null;
    readiness: CodexNativeRuntimeReadiness;
  }> {
    const accountIdentity = this.runtime.getActiveAccountIdentity(context.authPathOrOptions ?? {});
    const checkedAt = this.now();
    if (!context.providerPlugin || typeof context.providerPlugin.listModels !== 'function') {
      return {
        models: null,
        readiness: {
          ready: false,
          runtimeReachable: false,
          accountIdentity,
          modelCount: null,
          checkedAt,
          errorMessage: 'Codex provider plugin does not expose a model catalog.',
        },
      };
    }
    try {
      const models = await context.providerPlugin.listModels({
        providerProfile: context.providerProfile,
      });
      const normalizedModels = Array.isArray(models) ? models : [];
      return {
        models: normalizedModels,
        readiness: {
          ready: Boolean(accountIdentity),
          runtimeReachable: true,
          accountIdentity,
          modelCount: normalizedModels.length,
          checkedAt,
          errorMessage: accountIdentity ? null : 'Codex auth state is unavailable.',
        },
      };
    } catch (error) {
      return {
        models: null,
        readiness: {
          ready: false,
          runtimeReachable: false,
          accountIdentity,
          modelCount: null,
          checkedAt,
          errorMessage: error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Unknown Codex native runtime error.',
        },
      };
    }
  }
}

function buildContinuationLookupError(
  previousResponseId: string,
  lookup: CodexNativeApiContinuationLookupResult | null,
): {
  status: number;
  message: string;
  code: string;
} {
  if (lookup?.status === 'expired') {
    return {
      status: 410,
      message: `previous_response_id has expired: ${previousResponseId}`,
      code: 'continuation_expired',
    };
  }
  return {
    status: 404,
    message: `Unknown previous_response_id: ${previousResponseId}`,
    code: 'continuation_not_found',
  };
}

function buildContinuationAffinityError({
  continuation,
  providerProfile,
  readiness,
}: {
  continuation: CodexNativeApiContinuationEntry;
  providerProfile: ProviderProfile;
  readiness: CodexNativeRuntimeReadiness;
}): {
  status: number;
  message: string;
  code: string;
} | null {
  if (continuation.providerProfileId !== providerProfile.id) {
    return {
      status: 409,
      message: `previous_response_id is bound to provider profile ${continuation.providerProfileId}, not ${providerProfile.id}.`,
      code: 'continuation_provider_mismatch',
    };
  }
  const currentAccountId = normalizeNullableString(readiness.accountIdentity?.accountId);
  if (continuation.activeAccountId && continuation.activeAccountId !== currentAccountId) {
    return {
      status: 409,
      message: `previous_response_id is bound to native account ${continuation.activeAccountId}, but current native account is ${currentAccountId ?? 'unknown'}.`,
      code: 'continuation_account_mismatch',
    };
  }
  return null;
}

function buildPromptFromResponsesRequest(request: JsonRecord): string {
  const instructions = normalizeString(request.instructions);
  const input = renderResponsesInput(request.input);
  if (!instructions && !input) {
    return '';
  }
  if (!instructions && typeof request.input === 'string') {
    return input;
  }
  const sections: string[] = [];
  if (instructions) {
    sections.push(`System instructions:\n${instructions}`);
  }
  if (input) {
    sections.push(`Conversation input:\n${input}`);
  }
  return sections.join('\n\n').trim();
}

function renderResponsesInput(input: unknown): string {
  if (typeof input === 'string') {
    return normalizeString(input);
  }
  const items = Array.isArray(input) ? input : [input];
  const parts = items
    .map((item) => renderResponsesInputItem(item))
    .filter(Boolean);
  return parts.join('\n\n').trim();
}

function renderResponsesInputItem(item: unknown): string {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const candidate = item as JsonRecord;
  const type = normalizeString(candidate.type);
  if (type === 'message' || !type) {
    const role = normalizeString(candidate.role) || 'user';
    const content = renderResponsesContent(candidate.content);
    if (!content) {
      return '';
    }
    return `${role.toUpperCase()}:\n${content}`;
  }
  if (type === 'function_call') {
    const name = normalizeString(candidate.name) || 'tool';
    const args = normalizeString(candidate.arguments) || '{}';
    return `ASSISTANT TOOL CALL ${name}:\n${args}`;
  }
  if (type === 'function_call_output') {
    const callId = normalizeString(candidate.call_id) || 'call';
    const output = normalizeString(candidate.output);
    if (!output) {
      return '';
    }
    return `TOOL RESULT ${callId}:\n${output}`;
  }
  return '';
}

function renderResponsesContent(content: unknown): string {
  if (typeof content === 'string') {
    return normalizeString(content);
  }
  const parts = Array.isArray(content) ? content : [content];
  return parts.map((part) => renderResponsesContentPart(part)).filter(Boolean).join('\n').trim();
}

function renderResponsesContentPart(part: unknown): string {
  if (!part || typeof part !== 'object') {
    return '';
  }
  const candidate = part as JsonRecord;
  const type = normalizeString(candidate.type);
  if (!type && typeof candidate.text === 'string') {
    return normalizeString(candidate.text);
  }
  if (type === 'input_text' || type === 'output_text' || type === 'text') {
    return normalizeString(candidate.text);
  }
  if (type === 'input_image' || type === 'image_url') {
    const imageUrl = normalizeString(candidate.image_url)
      || normalizeString(candidate.image_url?.url);
    return imageUrl ? `[image input: ${imageUrl}]` : '[image input]';
  }
  if (type === 'input_file' || type === 'file') {
    const fileName = normalizeString(candidate.filename)
      || normalizeString(candidate.file?.filename)
      || normalizeString(candidate.file_id)
      || normalizeString(candidate.file?.file_id)
      || 'file';
    return `[file input: ${fileName}]`;
  }
  return '';
}

function buildResponsesObject({
  request,
  responseId,
  createdAt,
  responseModel,
  status,
  outputText = null,
  output = null,
  error = null,
  usage = null,
  incompleteDetails = null,
  nativeRuntime,
}: {
  request: JsonRecord;
  responseId: string;
  createdAt: number;
  responseModel: string | null;
  status: string;
  outputText?: string | null;
  output?: JsonRecord[] | null;
  error?: JsonRecord | null;
  usage?: JsonRecord | null;
  incompleteDetails?: JsonRecord | null;
  nativeRuntime: JsonRecord;
}): JsonRecord {
  const normalizedOutput = Array.isArray(output)
    ? output
    : outputText
      ? [{
        id: `msg_${crypto.randomUUID()}`,
        type: 'message',
        status: status === 'completed' ? 'completed' : 'incomplete',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: outputText,
          annotations: [],
        }],
      }]
      : [];
  return omitUndefined({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error,
    incomplete_details: incompleteDetails,
    background: false,
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? request.max_tokens ?? null,
    max_tool_calls: request.max_tool_calls ?? null,
    model: request.model ?? responseModel ?? null,
    output: normalizedOutput,
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    previous_response_id: request.previous_response_id ?? null,
    prompt_cache_key: request.prompt_cache_key ?? null,
    reasoning: request.reasoning ?? null,
    safety_identifier: request.safety_identifier ?? null,
    service_tier: request.service_tier ?? null,
    store: request.store ?? false,
    temperature: request.temperature,
    text: request.text ?? { format: { type: 'text' } },
    tool_choice: request.tool_choice ?? 'auto',
    tools: request.tools ?? [],
    top_logprobs: request.top_logprobs,
    top_p: request.top_p,
    truncation: request.truncation ?? 'disabled',
    user: request.user ?? null,
    metadata: request.metadata ?? null,
    usage,
    native_runtime: nativeRuntime,
  });
}

function createResponsesStreamState({
  request,
  responseId,
  createdAt,
  responseModel,
  nativeRuntime,
}: {
  request: JsonRecord;
  responseId: string;
  createdAt: number;
  responseModel: string | null;
  nativeRuntime: JsonRecord;
}): ResponsesStreamState {
  return {
    request,
    responseId,
    createdAt,
    responseModel,
    initialNativeRuntime: nativeRuntime,
    output: [],
    reasoning: null,
    message: null,
    createdEmitted: false,
    terminalEmitted: false,
    nextOutputIndex: 0,
    sequence: 0,
  };
}

function ensureResponsesStreamStarted(state: ResponsesStreamState): JsonRecord[] {
  if (state.createdEmitted) {
    return [];
  }
  state.createdEmitted = true;
  const response = buildResponsesObject({
    request: state.request,
    responseId: state.responseId,
    createdAt: state.createdAt,
    responseModel: state.responseModel,
    status: 'in_progress',
    output: [],
    nativeRuntime: state.initialNativeRuntime,
  });
  return [
    withResponsesStreamSequence(state, {
      type: 'response.created',
      response,
    }),
    withResponsesStreamSequence(state, {
      type: 'response.in_progress',
      response,
    }),
  ];
}

function appendResponsesStreamProgress(
  state: ResponsesStreamState,
  progress: ProviderTurnProgress,
): JsonRecord[] {
  const delta = rawString(progress.delta);
  if (!delta) {
    return [];
  }
  return normalizeString(progress.outputKind) === 'final_answer'
    ? appendResponsesStreamMessageDelta(state, delta)
    : appendResponsesStreamReasoningDelta(state, delta);
}

function appendResponsesStreamReasoningDelta(
  state: ResponsesStreamState,
  delta: string,
): JsonRecord[] {
  if (!delta) {
    return [];
  }
  const events = ensureResponsesStreamStarted(state);
  let reasoning = state.reasoning;
  if (!reasoning) {
    reasoning = {
      id: `rs_${crypto.randomUUID()}`,
      outputIndex: allocateResponsesStreamOutputIndex(state),
      text: '',
      added: false,
      partAdded: false,
      done: false,
    };
    state.reasoning = reasoning;
    state.output.push({
      id: reasoning.id,
      type: 'reasoning',
      status: 'in_progress',
      summary: [],
    });
  }
  if (!reasoning.added) {
    reasoning.added = true;
    events.push(withResponsesStreamSequence(state, {
      type: 'response.output_item.added',
      output_index: reasoning.outputIndex,
      item: cloneJson(state.output[reasoning.outputIndex]),
    }));
  }
  if (!reasoning.partAdded) {
    reasoning.partAdded = true;
    events.push(withResponsesStreamSequence(state, {
      type: 'response.reasoning_summary_part.added',
      item_id: reasoning.id,
      output_index: reasoning.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: '',
      },
    }));
  }
  reasoning.text += delta;
  events.push(withResponsesStreamSequence(state, {
    type: 'response.reasoning_summary_text.delta',
    item_id: reasoning.id,
    output_index: reasoning.outputIndex,
    summary_index: 0,
    delta,
  }));
  return events;
}

function appendResponsesStreamMessageDelta(
  state: ResponsesStreamState,
  delta: string,
): JsonRecord[] {
  if (!delta) {
    return [];
  }
  const events = ensureResponsesStreamStarted(state);
  let message = state.message;
  if (!message) {
    message = {
      id: `msg_${crypto.randomUUID()}`,
      outputIndex: allocateResponsesStreamOutputIndex(state),
      text: '',
      added: false,
      contentAdded: false,
      done: false,
    };
    state.message = message;
    state.output.push({
      id: message.id,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    });
  }
  if (!message.added) {
    message.added = true;
    events.push(withResponsesStreamSequence(state, {
      type: 'response.output_item.added',
      output_index: message.outputIndex,
      item: cloneJson(state.output[message.outputIndex]),
    }));
  }
  if (!message.contentAdded) {
    message.contentAdded = true;
    events.push(withResponsesStreamSequence(state, {
      type: 'response.content_part.added',
      item_id: message.id,
      output_index: message.outputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    }));
  }
  message.text += delta;
  events.push(withResponsesStreamSequence(state, {
    type: 'response.output_text.delta',
    item_id: message.id,
    output_index: message.outputIndex,
    content_index: 0,
    delta,
  }));
  return events;
}

function syncResponsesStreamMessageToTerminalText(
  state: ResponsesStreamState,
  text: string,
): JsonRecord[] {
  if (!text) {
    return [];
  }
  const currentText = state.message?.text ?? '';
  if (!currentText) {
    return appendResponsesStreamMessageDelta(state, text);
  }
  if (text.startsWith(currentText)) {
    return appendResponsesStreamMessageDelta(state, text.slice(currentText.length));
  }
  if (state.message) {
    state.message.text = text;
  }
  return [];
}

function finishResponsesStreamState(
  state: ResponsesStreamState,
  {
    status,
    incompleteDetails = null,
    nativeRuntime,
  }: {
    status: string;
    incompleteDetails?: JsonRecord | null;
    nativeRuntime: JsonRecord;
  },
): JsonRecord[] {
  if (state.terminalEmitted) {
    return [];
  }
  state.terminalEmitted = true;
  return [
    ...ensureResponsesStreamStarted(state),
    ...finishOpenResponsesStreamItems(state),
    withResponsesStreamSequence(state, {
      type: 'response.completed',
      response: buildResponsesObject({
        request: state.request,
        responseId: state.responseId,
        createdAt: state.createdAt,
        responseModel: state.responseModel,
        status,
        output: cloneJson(state.output),
        incompleteDetails,
        nativeRuntime,
      }),
    }),
  ];
}

function failResponsesStreamState(
  state: ResponsesStreamState,
  error: JsonRecord,
  nativeRuntime: JsonRecord,
): JsonRecord[] {
  if (state.terminalEmitted) {
    return [];
  }
  state.terminalEmitted = true;
  return [
    ...ensureResponsesStreamStarted(state),
    ...finishOpenResponsesStreamItems(state),
    withResponsesStreamSequence(state, {
      type: 'response.failed',
      response: buildResponsesObject({
        request: state.request,
        responseId: state.responseId,
        createdAt: state.createdAt,
        responseModel: state.responseModel,
        status: 'failed',
        output: cloneJson(state.output),
        error,
        nativeRuntime,
      }),
    }),
  ];
}

function finishOpenResponsesStreamItems(state: ResponsesStreamState): JsonRecord[] {
  const closers: Array<{ outputIndex: number; run: () => JsonRecord[] }> = [];
  if (state.reasoning && !state.reasoning.done) {
    closers.push({
      outputIndex: state.reasoning.outputIndex,
      run: () => finishResponsesStreamReasoningState(state),
    });
  }
  if (state.message && !state.message.done) {
    closers.push({
      outputIndex: state.message.outputIndex,
      run: () => finishResponsesStreamMessageState(state),
    });
  }
  closers.sort((left, right) => left.outputIndex - right.outputIndex);
  const events: JsonRecord[] = [];
  for (const closer of closers) {
    events.push(...closer.run());
  }
  return events;
}

function finishResponsesStreamReasoningState(state: ResponsesStreamState): JsonRecord[] {
  const reasoning = state.reasoning;
  if (!reasoning || reasoning.done) {
    return [];
  }
  reasoning.done = true;
  const item = state.output[reasoning.outputIndex];
  item.status = 'completed';
  item.summary = reasoning.text
    ? [{
      type: 'summary_text',
      text: reasoning.text,
    }]
    : [];
  return [
    withResponsesStreamSequence(state, {
      type: 'response.reasoning_summary_text.done',
      item_id: reasoning.id,
      output_index: reasoning.outputIndex,
      summary_index: 0,
      text: reasoning.text,
    }),
    withResponsesStreamSequence(state, {
      type: 'response.reasoning_summary_part.done',
      item_id: reasoning.id,
      output_index: reasoning.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: reasoning.text,
      },
    }),
    withResponsesStreamSequence(state, {
      type: 'response.output_item.done',
      output_index: reasoning.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

function finishResponsesStreamMessageState(state: ResponsesStreamState): JsonRecord[] {
  const message = state.message;
  if (!message || message.done) {
    return [];
  }
  message.done = true;
  const item = state.output[message.outputIndex];
  item.status = 'completed';
  item.content = [{
    type: 'output_text',
    text: message.text,
    annotations: [],
  }];
  return [
    withResponsesStreamSequence(state, {
      type: 'response.output_text.done',
      item_id: message.id,
      output_index: message.outputIndex,
      content_index: 0,
      text: message.text,
    }),
    withResponsesStreamSequence(state, {
      type: 'response.content_part.done',
      item_id: message.id,
      output_index: message.outputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: message.text,
        annotations: [],
      },
    }),
    withResponsesStreamSequence(state, {
      type: 'response.output_item.done',
      output_index: message.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

function allocateResponsesStreamOutputIndex(state: ResponsesStreamState): number {
  const index = state.nextOutputIndex;
  state.nextOutputIndex += 1;
  return index;
}

function withResponsesStreamSequence(state: ResponsesStreamState, payload: JsonRecord): JsonRecord {
  const next = {
    ...payload,
    sequence_number: state.sequence,
  };
  state.sequence += 1;
  return next;
}

function buildRuntimeMetadata({
  providerProfile,
  readiness,
  threadId = null,
  turnId = null,
  bridgeSessionId = null,
}: {
  providerProfile: ProviderProfile;
  readiness: CodexNativeRuntimeReadiness;
  threadId?: string | null;
  turnId?: string | null;
  bridgeSessionId?: string | null;
}): JsonRecord {
  return omitUndefined({
    provider_profile_id: providerProfile.id,
    provider_kind: providerProfile.providerKind,
    ready: readiness.ready,
    runtime_reachable: readiness.runtimeReachable,
    checked_at: readiness.checkedAt,
    model_count: readiness.modelCount,
    error_message: readiness.errorMessage,
    account_identity: readiness.accountIdentity
      ? omitUndefined({
        account_id: readiness.accountIdentity.accountId ?? null,
        email: readiness.accountIdentity.email ?? null,
        name: readiness.accountIdentity.name ?? null,
        plan: readiness.accountIdentity.plan ?? null,
        auth_mode: readiness.accountIdentity.authMode ?? null,
      })
      : null,
    thread_id: threadId,
    turn_id: turnId,
    bridge_session_id: bridgeSessionId,
  });
}

function serializeContinuationRegistryDescriptor(
  descriptor: CodexNativeApiContinuationRegistryDescriptor,
): JsonRecord {
  return omitUndefined({
    kind: normalizeString(descriptor.kind) || 'unknown',
    persistence: descriptor.persistence,
    survives_process_restart: descriptor.persistence === 'persistent',
    ttl_ms: Number.isFinite(descriptor.ttlMs) ? Number(descriptor.ttlMs) : null,
  });
}

function serializeModel(model: ProviderModelInfo, providerProfile: ProviderProfile): JsonRecord {
  return omitUndefined({
    id: normalizeString(model.id) || normalizeString(model.model),
    object: 'model',
    created: 0,
    owned_by: providerProfile.id,
    provider_kind: providerProfile.providerKind,
    provider_model: normalizeString(model.model) || normalizeString(model.id),
    display_name: normalizeString(model.displayName) || normalizeString(model.id),
    description: normalizeString(model.description) || undefined,
    default: Boolean(model.isDefault),
    capabilities: {
      supported_reasoning_efforts: Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.filter((value) => typeof value === 'string' && value.trim())
        : [],
      default_reasoning_effort: normalizeNullableString(model.defaultReasoningEffort),
    },
  });
}

function deriveRequestTitle(prefix: string, prompt: string): string {
  const preview = truncateText(firstNonEmptyLine(prompt), 72);
  if (!preview) {
    return prefix;
  }
  return `${prefix}: ${preview}`;
}

function firstNonEmptyLine(value: string): string {
  return normalizeString(value.split('\n').find((line) => normalizeString(line)) ?? '');
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new Error(`Request body exceeded ${maxBodyBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Malformed JSON request body.';
    throw new Error(message);
  }
}

function startSse(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function writeSseEvent(response: ServerResponse, payload: JsonRecord): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  const eventName = normalizeString(payload.type) || 'message';
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function finishSse(response: ServerResponse): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.end('data: [DONE]\n\n');
}

function writeJson(response: ServerResponse, status: number, body: JsonRecord): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function rawString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function extractInternalCodexbridgeEventMetadata(requestMetadata: JsonRecord | null): JsonRecord | undefined {
  const codexbridge = normalizeRecord(requestMetadata?.codexbridge);
  const eventMetadata = normalizeRecord(codexbridge?.eventMetadata);
  return eventMetadata ? { codexbridge: eventMetadata } : undefined;
}

function extractInternalCodexbridgeThreadMetadata(requestMetadata: JsonRecord | null): JsonRecord | null {
  const codexbridge = normalizeRecord(requestMetadata?.codexbridge);
  return normalizeRecord(codexbridge?.threadMetadata);
}

function extractInternalCodexbridgeTaskClass(requestMetadata: JsonRecord | null): string | null {
  const codexbridge = normalizeRecord(requestMetadata?.codexbridge);
  return normalizeNullableString(codexbridge?.taskClass);
}

function omitUndefined<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
