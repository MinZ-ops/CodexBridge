#!/usr/bin/env node

import {
  createCodexGatewayStandaloneServerFromEnv,
  resolveCodexGatewayStandaloneServerEnv,
} from './server/standalone_server.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const env = resolveCodexGatewayStandaloneServerEnv({
    env: process.env,
    envFilePath: args.envFilePath,
  });
  const { config, server } = createCodexGatewayStandaloneServerFromEnv(env);
  await server.start();

  console.log('Codex Gateway standalone server started.');
  console.log(`Provider preset: ${config.presetId}`);
  console.log(`Provider: ${config.providerName} (${config.providerKind})`);
  console.log(`Upstream base URL: ${config.upstreamBaseUrl}`);
  console.log(`Default model: ${config.defaultModel}`);
  console.log(`Local base URL: ${server.baseUrl}`);
  console.log(`Model catalog source: ${config.modelCatalogSource}`);
  if (args.envFilePath || env.CODEX_GATEWAY_ENV_FILE) {
    console.log(`Env file: ${args.envFilePath ?? env.CODEX_GATEWAY_ENV_FILE}`);
  }
  console.log('Routes: GET /v1/models, POST /v1/responses, POST /v1/responses/compact');
  console.log('Press Ctrl+C to stop.');

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, stopping Codex Gateway standalone server...`);
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function parseCliArgs(argv: string[]): {
  envFilePath: string | null;
  help: boolean;
} {
  let envFilePath: string | null = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--env-file') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--env-file requires a path argument.');
      }
      envFilePath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown codex-gateway-server argument: ${arg}`);
  }

  return { envFilePath, help };
}

function printHelp(): void {
  console.log([
    'Usage: codex-gateway-server [--env-file <path>]',
    '',
    'Internal-only launcher for the Codex Gateway local /v1/responses adapter server.',
    '',
    'Options:',
    '  --env-file <path>  Load dotenv-style defaults before resolving provider env',
    '  -h, --help         Show this help message',
  ].join('\n'));
}
