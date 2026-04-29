import { z } from 'zod';

import type { VoiceAgentKitConfig } from '../types/index.js';

const LatencyBudgetSchema = z.object({
  total: z.object({
    target: z.number().min(100).max(5000),
    hardCap: z.number().min(200).max(10000),
  }),
  stages: z.object({
    stt: z.number().min(50).max(2000),
    mcp: z.number().min(100).max(5000),
    tts: z.number().min(50).max(2000),
  }),
});

const STTConfigSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  sampleRate: z.number().default(8000),
}).catchall(z.unknown());

const TTSConfigSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).default(1.0),
}).catchall(z.unknown());

const MCPConfigSchema = z.object({
  endpoint: z.string().url(),
  auth: z.object({
    type: z.string().min(1),
    credentials: z.record(z.string(), z.string()),
  }).optional(),
  timeout: z.number().min(100).max(30000).default(400),
});

const BargeInConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minSpeechDuration: z.number().min(0).max(5000).default(300),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  silenceThreshold: z.number().min(0).max(1).default(0.3),
});

const SessionConfigSchema = z.object({
  ttl: z.number().min(60).max(86400).default(3600),
  history: z.object({
    maxTurns: z.number().min(1).max(100).default(20),
    maxTokens: z.number().min(100).max(100000).default(4000),
  }),
});

export const VoiceAgentKitConfigSchema = z.object({
  mcp: MCPConfigSchema,
  stt: STTConfigSchema,
  tts: TTSConfigSchema,
  latency: LatencyBudgetSchema,
  session: SessionConfigSchema,
  bargeIn: BargeInConfigSchema,
});

export function loadConfig(configPath?: string): VoiceAgentKitConfig {
  const config = loadConfigFile(configPath);
  return parseConfig(config);
}

function loadEnvConfig(): Record<string, unknown> {
  const envConfig: Record<string, unknown> = {};

  if (process.env.MCP_ENDPOINT) {
    envConfig.mcp = {
      endpoint: process.env.MCP_ENDPOINT,
      auth: process.env.MCP_API_KEY ? {
        type: 'bearer',
        credentials: { token: process.env.MCP_API_KEY },
      } : undefined,
      timeout: process.env.MCP_TIMEOUT ? parseInt(process.env.MCP_TIMEOUT, 10) : 400,
    };
  }

  if (process.env.STT_PROVIDER) {
    envConfig.stt = {
      provider: process.env.STT_PROVIDER,
      apiKey: process.env.STT_API_KEY,
      sampleRate: process.env.STT_SAMPLE_RATE ? parseInt(process.env.STT_SAMPLE_RATE, 10) : 8000,
    };
  }

  if (process.env.TTS_PROVIDER) {
    envConfig.tts = {
      provider: process.env.TTS_PROVIDER,
      apiKey: process.env.TTS_API_KEY,
      voice: process.env.TTS_VOICE,
    };
  }

  return envConfig;
}

function loadConfigFile(configPath?: string): Record<string, unknown> {
  // configPath parameter reserved for future file-based config support
  void configPath;

  const envConfig = loadEnvConfig();
  if (Object.keys(envConfig).length > 0) {
    return envConfig;
  }

  return {};
}

function parseConfig(rawConfig: Record<string, unknown>): VoiceAgentKitConfig {
  const result = VoiceAgentKitConfigSchema.safeParse(rawConfig);
  
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid configuration: ${errors}`);
  }
  
  return result.data;
}

export function defineConfig(config: VoiceAgentKitConfig): VoiceAgentKitConfig {
  return VoiceAgentKitConfigSchema.parse(config);
}

export function getDefaultConfig(): VoiceAgentKitConfig {
  return {
    mcp: {
      endpoint: 'http://localhost:3000/mcp',
      timeout: 400,
    },
    stt: {
      provider: 'deepgram',
      sampleRate: 8000,
    },
    tts: {
      provider: 'deepgram',
      speed: 1.0,
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
  };
}
