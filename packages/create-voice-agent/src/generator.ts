import chalk from 'chalk';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

import type {
  ApiKeys,
  ProjectOptions,
  SttProvider,
  TelephonyProvider,
  TransportType,
  TtsProvider,
} from './types.js';
import { STT_PROVIDERS, TELEPHONY_PROVIDERS, TTS_PROVIDERS } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveTemplateDir(): string | null {
  const paths = [
    path.resolve(__dirname, '..', '..', '..', 'examples', 'quickstart'),
    path.resolve(process.cwd(), 'examples', 'quickstart'),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

export async function generateProject(projectDir: string, options: ProjectOptions): Promise<void> {
  const srcDir = path.join(projectDir, 'src');

  console.log(chalk.blue(`\nCreating project in ${chalk.bold(projectDir)}\n`));

  await fs.ensureDir(srcDir);

  const templateDir = resolveTemplateDir();
  if (templateDir) {
    await copySrcFiles(templateDir, srcDir);
  }
  await writeConfigFile(projectDir, options);
  await writeEnvFiles(projectDir, options);
  await writePackageJson(projectDir, options);
  await writeTsConfig(projectDir, options);
  await writeReadme(projectDir, options);
  await writeServerFile(srcDir, options);

  if (!options.skipInstall) {
    await runInstall(projectDir);
  }

  printSuccessMessage(projectDir, options);
}

async function copySrcFiles(templateDir: string, destSrcDir: string): Promise<void> {
  const templateSrc = path.join(templateDir, 'src');
  if (fs.existsSync(templateSrc)) {
    await fs.copy(templateSrc, destSrcDir, { overwrite: true });
  }
}

async function writeConfigFile(projectDir: string, options: ProjectOptions): Promise<void> {
  const sttConfig = buildSttConfig(options.sttProvider);
  const ttsConfig = buildTtsConfig(options.ttsProvider);
  const transportConfig = buildTransportConfig(options.transport, options.telephony);

  const content = `import { defineConfig } from '@reaatech/voice-agent-core';

export default defineConfig({
  stt: {
${sttConfig}
  },
  tts: {
${ttsConfig}
  },
  mcp: {
    endpoint: process.env.MCP_ENDPOINT || '${options.mcpEndpoint}',
    timeout: 400,
  },
  latency: {
    total: {
      target: 800,
      hardCap: 1200,
    },
    stages: {
      stt: 200,
      mcp: 400,
      tts: 200,
    },
  },
  session: {
    ttl: 3600,
    history: {
      maxTurns: 20,
      maxTokens: 4000,
    },
  },
  bargeIn: {
    enabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  },
${transportConfig}
});
`;

  await fs.writeFile(path.join(projectDir, 'voice-agent-kit.config.ts'), content);
}

function buildSttConfig(provider: SttProvider): string {
  const cfg = STT_PROVIDERS[provider];
  const lines: string[] = [];

  for (const [key, value] of Object.entries(cfg.defaults)) {
    if (key === 'provider') {
      lines.push(`provider: '${value}',`);
    } else if (key === 'encoding' || key === 'outputFormat') {
      lines.push(`${key}: '${value}' as const,`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: '${value}',`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value},`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)},`);
    }
  }

  if (provider === 'deepgram') {
    lines.push(`apiKey: process.env.DEEPGRAM_API_KEY,`);
  } else if (provider === 'openai-realtime' || provider === 'openai-whisper') {
    lines.push(`apiKey: process.env.OPENAI_API_KEY,`);
  } else if (provider === 'assemblyai') {
    lines.push(`apiKey: process.env.ASSEMBLYAI_API_KEY,`);
  } else if (provider === 'groq-whisper') {
    lines.push(`apiKey: process.env.GROQ_API_KEY,`);
  } else if (provider === 'aws-transcribe') {
    lines.push(`region: process.env.AWS_REGION || 'us-east-1',`);
  }

  return lines.map((l) => `    ${l}`).join('\n');
}

function buildTtsConfig(provider: TtsProvider): string {
  const cfg = TTS_PROVIDERS[provider];
  const lines: string[] = [];

  for (const [key, value] of Object.entries(cfg.defaults)) {
    if (key === 'provider') {
      lines.push(`provider: '${value}',`);
    } else if (key === 'encoding' || key === 'outputFormat') {
      lines.push(`${key}: '${value}' as const,`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: '${value}',`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value},`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)},`);
    }
  }

  if (provider === 'deepgram') {
    lines.push(`apiKey: process.env.DEEPGRAM_API_KEY,`);
  } else if (provider === 'elevenlabs') {
    lines.push(`apiKey: process.env.ELEVENLABS_API_KEY,`);
  } else if (provider === 'cartesia') {
    lines.push(`apiKey: process.env.CARTESIA_API_KEY,`);
  } else if (provider === 'aws-polly') {
    lines.push(`region: process.env.AWS_REGION || 'us-east-1',`);
  }

  return lines.map((l) => `    ${l}`).join('\n');
}

function buildTransportConfig(transport: TransportType, telephony: TelephonyProvider): string {
  if (transport === 'webrtc') {
    return `  transport: {
    type: 'webrtc',
    sampleRate: 16000,
    channels: 1,
  },`;
  }

  return `  transport: {
    type: '${telephony === 'twilio' ? 'twilio' : telephony}',
    sampleRate: 8000,
    channels: 1,
  },`;
}

async function writeEnvFiles(projectDir: string, options: ProjectOptions): Promise<void> {
  const envVars = collectEnvVars(options);
  const envLines: string[] = [];
  const envExampleLines: string[] = [];

  for (const [key] of envVars) {
    const value = options.apiKeys[key as keyof ApiKeys] || '';
    envLines.push(`${key}=${value}`);
    envExampleLines.push(`${key}=your_${key.toLowerCase()}_here`);
  }

  envLines.push('');
  envLines.push(`# MCP server endpoint`);
  envLines.push(`MCP_ENDPOINT=${options.mcpEndpoint}`);
  envExampleLines.push('');
  envExampleLines.push(`# MCP server endpoint`);
  envExampleLines.push(`MCP_ENDPOINT=http://localhost:3000/mcp`);

  if (options.apiKeys.MCP_API_KEY) {
    envLines.push(`MCP_API_KEY=${options.apiKeys.MCP_API_KEY}`);
  }
  envExampleLines.push(`# MCP_API_KEY=your_mcp_api_key_here`);

  envLines.push('');
  envLines.push(`# Server port (default: 3000)`);
  envLines.push(`# PORT=3000`);
  envExampleLines.push('');
  envExampleLines.push(`# Server port (default: 3000)`);
  envExampleLines.push(`# PORT=3000`);

  envLines.push('');
  envExampleLines.push('');

  await fs.writeFile(path.join(projectDir, '.env'), envLines.join('\n'));
  await fs.writeFile(path.join(projectDir, '.env.example'), envExampleLines.join('\n'));
}

function collectEnvVars(options: ProjectOptions): [string, string][] {
  const vars: [string, string][] = [];

  const sttKeys = STT_PROVIDERS[options.sttProvider].keys;
  for (const key of sttKeys) {
    vars.push([key, descriptionForKey(key)]);
  }

  const ttsKeys = TTS_PROVIDERS[options.ttsProvider].keys;
  for (const key of ttsKeys) {
    if (!sttKeys.includes(key)) {
      vars.push([key, descriptionForKey(key)]);
    }
  }

  const telKeys = TELEPHONY_PROVIDERS[options.telephony].keys;
  for (const key of telKeys) {
    vars.push([key, descriptionForKey(key)]);
  }

  return vars;
}

function descriptionForKey(key: string): string {
  const descriptions: Record<string, string> = {
    DEEPGRAM_API_KEY: '# Deepgram API key (STT + TTS)',
    OPENAI_API_KEY: '# OpenAI API key',
    ASSEMBLYAI_API_KEY: '# AssemblyAI API key',
    GROQ_API_KEY: '# Groq API key',
    AWS_ACCESS_KEY_ID: '# AWS access key ID',
    AWS_SECRET_ACCESS_KEY: '# AWS secret access key',
    AWS_REGION: '# AWS region',
    GOOGLE_APPLICATION_CREDENTIALS: '# Path to Google Cloud service account JSON',
    ELEVENLABS_API_KEY: '# ElevenLabs API key',
    CARTESIA_API_KEY: '# Cartesia API key',
    TWILIO_ACCOUNT_SID: '# Twilio Account SID',
    TWILIO_AUTH_TOKEN: '# Twilio Auth Token',
    TWILIO_PHONE_NUMBER: '# Twilio phone number (E.164 format)',
    TELNYX_API_KEY: '# Telnyx API key',
    TELNYX_SIP_DOMAIN: '# Telnyx SIP domain',
  };
  return descriptions[key] ?? `# ${key}`;
}

async function writePackageJson(projectDir: string, options: ProjectOptions): Promise<void> {
  const deps: Record<string, string> = {
    '@reaatech/voice-agent-core': '^0.1.0',
    '@reaatech/voice-agent-stt': '^0.1.0',
    '@reaatech/voice-agent-tts': '^0.1.0',
    '@reaatech/voice-agent-mcp-client': '^0.1.0',
    fastify: '^5.8.5',
    '@fastify/formbody': '^8.0.2',
    '@fastify/websocket': '^11.2.0',
  };

  if (options.transport === 'twilio') {
    deps['@reaatech/voice-agent-telephony'] = '^0.1.0';
  }

  if (options.transport === 'webrtc') {
    deps['@reaatech/voice-agent-webrtc'] = '^0.1.0';
    deps.ws = '^8.20.1';
  }

  const pkg = {
    name: options.projectName,
    version: '0.1.0',
    private: true,
    description: `Voice AI agent powered by voice-agent-kit (${options.sttProvider} / ${options.ttsProvider} / ${options.transport})`,
    license: 'MIT',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsup src/index.ts',
      start: 'node dist/index.js',
      typecheck: 'tsc --noEmit',
    },
    dependencies: deps,
    devDependencies: {
      '@types/node': '^25.6.2',
      '@types/ws': '^8.5.10',
      tsup: '^8.5.1',
      tsx: '^4.20.1',
      typescript: '^6.0.3',
    },
    engines: {
      node: '>=20.0.0',
    },
  };

  await fs.writeFile(path.join(projectDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function writeTsConfig(projectDir: string, _options: ProjectOptions): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022'],
      types: ['node'],
      declaration: true,
      sourceMap: true,
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      strictFunctionTypes: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      outDir: './dist',
      rootDir: '.',
    },
    include: ['src/**/*.ts', 'voice-agent-kit.config.ts'],
    exclude: ['node_modules', 'dist'],
  };

  await fs.writeFile(
    path.join(projectDir, 'tsconfig.json'),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
  );
}

async function writeReadme(projectDir: string, options: ProjectOptions): Promise<void> {
  const transportSection = buildTransportReadmeSection(options);
  const envVarTable = buildEnvVarTable(options);

  const readme = `# ${options.projectName}

Voice AI agent powered by [voice-agent-kit](https://github.com/reaatech/voice-agent-kit) using **${options.sttProvider}** for speech-to-text and **${options.ttsProvider}** for text-to-speech over **${options.transport}**.

## Quick Start

\`\`\`bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start the server
pnpm dev
\`\`\`

${transportSection}

## Endpoints

${
  options.transport === 'twilio'
    ? `| Method | Path             | Description                        |
|--------|------------------|------------------------------------|
| POST   | \`/incoming-call\` | Twilio webhook — returns TwiML     |
| GET    | \`/stream\`        | WebSocket upgrade — media stream   |
| GET    | \`/health\`        | Health check + active session count|`
    : `| Method | Path             | Description                        |
|--------|------------------|------------------------------------|
| GET    | \`/stream\`        | WebSocket upgrade — media stream   |
| GET    | \`/health\`        | Health check + active session count|`
}

## Environment Variables

${envVarTable}

## Architecture

\`\`\`
${
  options.transport === 'twilio'
    ? `Twilio PSTN → Twilio Webhook (POST /incoming-call)
  → TwiML <Connect><Stream>
    → Twilio Media Streams WebSocket (wss://.../stream)
      → TwilioMediaStreamHandler
        → Pipeline (STT → MCP → TTS)
          → Twilio Audio Output`
    : `Browser → WebSocket (wss://.../stream)
  → WebRTCTransport (Opus decode → PCM → resample)
    → Pipeline (STT → MCP → TTS)
      → WebRTCTransport (PCM → Opus encode)
        → Browser Audio Output`
}
\`\`\`

## Built With

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Pipeline, session, latency
- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text (${options.sttProvider})
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech (${options.ttsProvider})
${
  options.transport === 'twilio'
    ? '- [@reaatech/voice-agent-telephony](https://www.npmjs.com/package/@reaatech/voice-agent-telephony) — Twilio Media Streams'
    : '- [@reaatech/voice-agent-webrtc](https://www.npmjs.com/package/@reaatech/voice-agent-webrtc) — WebRTC transport'
}
- [@reaatech/voice-agent-mcp-client](https://www.npmjs.com/package/@reaatech/voice-agent-mcp-client) — MCP client
`;

  await fs.writeFile(path.join(projectDir, 'README.md'), readme);
}

function buildTransportReadmeSection(options: ProjectOptions): string {
  if (options.transport === 'twilio' && options.telephony === 'twilio') {
    return `## Configure Twilio

1. In your Twilio Console, go to Phone Numbers → Manage → Active Numbers
2. Select your phone number
3. Under "Voice & Fax", set the webhook for "A call comes in" to:
   \`\`\`
   https://your-server.example.com/incoming-call
   \`\`\`
   (HTTP POST)

4. Call the number — your voice agent answers.
`;
  }

  if (options.transport === 'webrtc') {
    return `## Connect Your Browser Client

The server exposes a WebSocket endpoint at \`/stream\` for browser clients.

Use the [@reaatech/voice-agent-webrtc](https://www.npmjs.com/package/@reaatech/voice-agent-webrtc) client library in your browser:

\`\`\`typescript
import { WebRTCTransport } from '@reaatech/voice-agent-webrtc';

const ws = new WebSocket('ws://localhost:3000/stream');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 }));
};
\`\`\`
`;
  }

  return '';
}

function buildEnvVarTable(options: ProjectOptions): string {
  const lines: string[] = [];
  lines.push('| Variable | Required | Description |');
  lines.push('|----------|----------|-------------|');

  const sttConfig = STT_PROVIDERS[options.sttProvider];
  for (const key of sttConfig.keys) {
    lines.push(`| \`${key}\` | Yes | ${envVarDescription(key)} |`);
  }

  const ttsConfig = TTS_PROVIDERS[options.ttsProvider];
  for (const key of ttsConfig.keys) {
    if (!sttConfig.keys.includes(key)) {
      lines.push(`| \`${key}\` | Yes | ${envVarDescription(key)} |`);
    }
  }

  const telConfig = TELEPHONY_PROVIDERS[options.telephony];
  for (const key of telConfig.keys) {
    lines.push(`| \`${key}\` | Yes | ${envVarDescription(key)} |`);
  }

  lines.push('| `MCP_ENDPOINT` | No | MCP server endpoint |');
  lines.push('| `MCP_API_KEY` | No | MCP server API key (if required) |');
  lines.push('| `PORT` | No | Server listen port (default: 3000) |');

  return lines.join('\n');
}

function envVarDescription(key: string): string {
  const descs: Record<string, string> = {
    DEEPGRAM_API_KEY: 'Deepgram API key',
    OPENAI_API_KEY: 'OpenAI API key',
    ASSEMBLYAI_API_KEY: 'AssemblyAI API key',
    GROQ_API_KEY: 'Groq API key',
    AWS_ACCESS_KEY_ID: 'AWS access key ID',
    AWS_SECRET_ACCESS_KEY: 'AWS secret access key',
    AWS_REGION: 'AWS region',
    GOOGLE_APPLICATION_CREDENTIALS: 'Path to Google Cloud credentials JSON',
    ELEVENLABS_API_KEY: 'ElevenLabs API key',
    CARTESIA_API_KEY: 'Cartesia API key',
    TWILIO_ACCOUNT_SID: 'Twilio Account SID',
    TWILIO_AUTH_TOKEN: 'Twilio Auth Token',
    TWILIO_PHONE_NUMBER: 'Twilio phone number',
    TELNYX_API_KEY: 'Telnyx API key',
    TELNYX_SIP_DOMAIN: 'Telnyx SIP domain',
  };
  return descs[key] ?? key;
}

async function writeServerFile(srcDir: string, options: ProjectOptions): Promise<void> {
  if (options.transport === 'webrtc') {
    await writeWebRtcServerFile(srcDir, options);
  } else {
    await writeTwilioServerFile(srcDir, options);
  }
}

async function writeTwilioServerFile(srcDir: string, options: ProjectOptions): Promise<void> {
  const content = `import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';

import type { AudioChunk, PipelineEvent } from '@reaatech/voice-agent-core';
import {
  createPipeline,
  getDefaultSessionManager,
  createLatencyBudget,
  LatencyBudgetEnforcer,
} from '@reaatech/voice-agent-core';
import type { Pipeline } from '@reaatech/voice-agent-core';
import { createSTTProvider } from '@reaatech/voice-agent-stt';
import { createTTSProvider } from '@reaatech/voice-agent-tts';
import { createMCPClient } from '@reaatech/voice-agent-mcp-client';
import { createTwilioHandler } from '@reaatech/voice-agent-telephony';

import config from '../voice-agent-kit.config.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const sessionManager = getDefaultSessionManager();

interface CallStartInfo {
  callSid: string;
  streamSid: string;
  codec?: string;
  customParameters?: Record<string, string>;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyFormbody);
  await app.register(fastifyWebsocket);

  app.post('/incoming-call', async (request, reply) => {
    const host = request.headers.host || \`localhost:\${PORT}\`;
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'ws' : 'wss';

    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="\${protocol}://\${host}/stream" />
  </Connect>
</Response>\`;

    reply.header('Content-Type', 'text/xml');
    return twiml;
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      activeSessions: sessionManager.getActiveSessionCount(),
    };
  });

  app.get('/stream', { websocket: true }, (socket, _request) => {
    const sttProvider = createSTTProvider({
      provider: '${options.sttProvider}',
      config: config.stt,
    });

    const ttsProvider = createTTSProvider({
      provider: '${options.ttsProvider}',
      config: config.tts,
    });

    const mcpClient = createMCPClient({
      endpoint: config.mcp.endpoint,
      auth: config.mcp.auth as
        | { type: 'bearer' | 'api-key' | 'oauth'; credentials: Record<string, string> }
        | undefined,
      timeout: config.mcp.timeout,
    });

    const latencyBudget = createLatencyBudget({
      target: config.latency.total.target,
      hardCap: config.latency.total.hardCap,
      stt: config.latency.stages.stt,
      mcp: config.latency.stages.mcp,
      tts: config.latency.stages.tts,
    });
    const latencyEnforcer = new LatencyBudgetEnforcer(latencyBudget);

    const handler = createTwilioHandler({
      bargeInEnabled: config.bargeIn.enabled,
      minSpeechDuration: config.bargeIn.minSpeechDuration,
      confidenceThreshold: config.bargeIn.confidenceThreshold,
      silenceThreshold: config.bargeIn.silenceThreshold,
    });

    const pipeline: Pipeline = createPipeline({
      sessionManager,
      latencyEnforcer,
      sttProvider,
      ttsProvider,
      mcpClient,
      config,
    });

    let sessionId: string | null = null;

    pipeline.on('pipeline:tts:start', () => {
      handler.setTTSPlaying(true);
    });

    pipeline.on('pipeline:tts:complete', () => {
      handler.setTTSPlaying(false);
    });

    pipeline.on('pipeline:tts:chunk', (event: PipelineEvent) => {
      const chunk = event.data?.chunk as AudioChunk | undefined;
      if (chunk) {
        handler.sendAudio(chunk);
      }
    });

    pipeline.on('pipeline:stt:interim', (event: PipelineEvent) => {
      const transcript = event.data?.transcript as string | undefined;
      const confidence = event.data?.confidence as number | undefined;
      if (transcript !== undefined && confidence !== undefined) {
        handler.onInterimTranscript(transcript, confidence);
      }
    });

    pipeline.on('pipeline:error', (event: PipelineEvent) => {
      app.log.error({ event }, 'Pipeline error');
    });

    handler.on('call:start', async (startInfo: CallStartInfo) => {
      const session = sessionManager.createSession({
        callSid: startInfo.callSid,
        mcpEndpoint: config.mcp.endpoint,
        sttProvider: config.stt.provider,
        ttsProvider: config.tts.provider,
        metadata: {
          streamSid: startInfo.streamSid,
          codec: startInfo.codec,
          customParameters: startInfo.customParameters,
        },
      });

      sessionId = session.sessionId;

      try {
        await pipeline.startSession({
          sessionId: session.sessionId,
          status: 'active',
        });
        app.log.info({ sessionId, callSid: startInfo.callSid }, 'Session started');
      } catch (error) {
        app.log.error({ error, sessionId }, 'Failed to start session');
      }
    });

    handler.on('audio:received', (chunk: AudioChunk) => {
      if (sessionId) {
        void pipeline.processAudioChunk(sessionId, chunk);
      }
    });

    handler.on('barge-in:detected', () => {
      if (sessionId) {
        pipeline.bargeIn(sessionId);
        void handler.clearAudio();
      }
    });

    handler.on('call:end', async () => {
      app.log.info({ sessionId }, 'Call ended');

      if (sessionId) {
        await pipeline.endSession(sessionId);
        sessionManager.closeSession(sessionId);
        sessionId = null;
      }

      pipeline.destroy();
    });

    handler.on('error', (error: Error) => {
      app.log.error({ error }, 'Twilio handler error');
    });

    void handler.acceptConnection(socket);
  });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(\`${options.projectName} server listening on port \${PORT}\`);
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
`;

  await fs.writeFile(path.join(srcDir, 'index.ts'), content);
}

async function writeWebRtcServerFile(srcDir: string, options: ProjectOptions): Promise<void> {
  const content = `import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

import type { AudioChunk, PipelineEvent } from '@reaatech/voice-agent-core';
import {
  createPipeline,
  getDefaultSessionManager,
  createLatencyBudget,
  LatencyBudgetEnforcer,
} from '@reaatech/voice-agent-core';
import type { Pipeline } from '@reaatech/voice-agent-core';
import { createSTTProvider } from '@reaatech/voice-agent-stt';
import { createTTSProvider } from '@reaatech/voice-agent-tts';
import { createMCPClient } from '@reaatech/voice-agent-mcp-client';
import { WebRTCTransport } from '@reaatech/voice-agent-webrtc';

import config from '../voice-agent-kit.config.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const sessionManager = getDefaultSessionManager();

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);

  app.get('/health', async () => {
    return {
      status: 'ok',
      activeSessions: sessionManager.getActiveSessionCount(),
    };
  });

  app.get('/stream', { websocket: true }, (socket, _request) => {
    const sttProvider = createSTTProvider({
      provider: '${options.sttProvider}',
      config: config.stt,
    });

    const ttsProvider = createTTSProvider({
      provider: '${options.ttsProvider}',
      config: config.tts,
    });

    const mcpClient = createMCPClient({
      endpoint: config.mcp.endpoint,
      auth: config.mcp.auth as
        | { type: 'bearer' | 'api-key' | 'oauth'; credentials: Record<string, string> }
        | undefined,
      timeout: config.mcp.timeout,
    });

    const latencyBudget = createLatencyBudget({
      target: config.latency.total.target,
      hardCap: config.latency.total.hardCap,
      stt: config.latency.stages.stt,
      mcp: config.latency.stages.mcp,
      tts: config.latency.stages.tts,
    });
    const latencyEnforcer = new LatencyBudgetEnforcer(latencyBudget);

    const transport = new WebRTCTransport({
      bargeInEnabled: config.bargeIn.enabled,
      minSpeechDuration: config.bargeIn.minSpeechDuration,
      confidenceThreshold: config.bargeIn.confidenceThreshold,
      silenceThreshold: config.bargeIn.silenceThreshold,
      outputSampleRate: config.stt.sampleRate ?? 16000,
      outputChannels: 1,
    });

    const pipeline: Pipeline = createPipeline({
      sessionManager,
      latencyEnforcer,
      sttProvider,
      ttsProvider,
      mcpClient,
      config,
    });

    let sessionId: string | null = null;

    pipeline.on('pipeline:tts:start', () => {
      transport.setTTSPlaying(true);
    });

    pipeline.on('pipeline:tts:complete', () => {
      transport.setTTSPlaying(false);
    });

    pipeline.on('pipeline:tts:chunk', (event: PipelineEvent) => {
      const chunk = event.data?.chunk as AudioChunk | undefined;
      if (chunk) {
        transport.sendAudio(chunk);
      }
    });

    pipeline.on('pipeline:stt:interim', (event: PipelineEvent) => {
      const transcript = event.data?.transcript as string | undefined;
      const confidence = event.data?.confidence as number | undefined;
      if (transcript !== undefined && confidence !== undefined) {
        transport.onInterimTranscript(transcript, confidence);
        transport.sendTranscript(transcript, false, confidence);
      }
    });

    pipeline.on('pipeline:stt:final', (event: PipelineEvent) => {
      const transcript = event.data?.transcript as string | undefined;
      if (transcript) {
        transport.sendTranscript(transcript, true);
      }
    });

    pipeline.on('pipeline:error', (event: PipelineEvent) => {
      app.log.error({ event }, 'Pipeline error');
    });

    transport.on('session:start', async (sessionMeta: { sessionId: string; codec?: string; sampleRate?: number; customParameters?: Record<string, string> }) => {
      const session = sessionManager.createSession({
        callSid: sessionMeta.sessionId,
        mcpEndpoint: config.mcp.endpoint,
        sttProvider: config.stt.provider,
        ttsProvider: config.tts.provider,
        metadata: {
          codec: sessionMeta.codec,
          transport: 'webrtc',
          customParameters: sessionMeta.customParameters,
        },
      });

      sessionId = session.sessionId;

      try {
        await pipeline.startSession({
          sessionId: session.sessionId,
          status: 'active',
        });
        app.log.info({ sessionId }, 'WebRTC session started');
      } catch (error) {
        app.log.error({ error, sessionId }, 'Failed to start session');
      }
    });

    transport.on('audio:received', (chunk: AudioChunk) => {
      if (sessionId) {
        void pipeline.processAudioChunk(sessionId, chunk);
      }
    });

    transport.on('barge-in:detected', () => {
      if (sessionId) {
        pipeline.bargeIn(sessionId);
        void transport.clearAudio();
      }
    });

    transport.on('session:end', async () => {
      app.log.info({ sessionId }, 'WebRTC session ended');

      if (sessionId) {
        await pipeline.endSession(sessionId);
        sessionManager.closeSession(sessionId);
        sessionId = null;
      }

      pipeline.destroy();
    });

    transport.on('error', (error: Error) => {
      app.log.error({ error }, 'WebRTC transport error');
    });

    void transport.acceptConnection(socket as unknown as import('ws').WebSocket);
  });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(\`${options.projectName} server listening on port \${PORT}\`);
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
`;

  await fs.writeFile(path.join(srcDir, 'index.ts'), content);
}

async function runInstall(projectDir: string): Promise<void> {
  console.log(chalk.blue('\nInstalling dependencies...\n'));

  try {
    const pm = detectPackageManager();
    execSync(`${pm} install`, {
      cwd: projectDir,
      stdio: 'inherit',
    });
    console.log(chalk.green('\nDependencies installed successfully.\n'));
  } catch {
    console.log(
      chalk.yellow('\nCould not install dependencies automatically. Run install manually:\n'),
    );
    console.log(chalk.cyan(`  cd ${projectDir}`));
    console.log(chalk.cyan(`  pnpm install\n`));
  }
}

function detectPackageManager(): string {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {
    try {
      execSync('npm --version', { stdio: 'ignore' });
      return 'npm';
    } catch {
      return 'npm';
    }
  }
}

function printSuccessMessage(projectDir: string, options: ProjectOptions): void {
  console.log(chalk.green.bold('\nProject created successfully!\n'));
  console.log(chalk.cyan('  Project:'), chalk.white(options.projectName));
  console.log(chalk.cyan('  STT:'), chalk.white(options.sttProvider));
  console.log(chalk.cyan('  TTS:'), chalk.white(options.ttsProvider));
  console.log(chalk.cyan('  Transport:'), chalk.white(options.transport));

  if (options.transport === 'twilio') {
    console.log(chalk.cyan('  Telephony:'), chalk.white(options.telephony));
  }

  console.log(chalk.cyan('  MCP:'), chalk.white(options.mcpEndpoint));
  console.log();

  if (options.skipInstall) {
    console.log(chalk.yellow('  Skipped dependency installation. Run manually:'));
    console.log(chalk.cyan(`    cd ${projectDir}`));
    console.log(chalk.cyan('    pnpm install\n'));
  } else {
    console.log(chalk.green('  To get started:'));
    console.log(chalk.cyan(`    cd ${projectDir}`));
    console.log(chalk.cyan('    pnpm dev\n'));
  }
}
