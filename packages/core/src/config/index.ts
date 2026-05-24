import { z } from 'zod';

import { DEFAULT_PRICING } from '../cost/default-pricing.js';
import type { TransportType, VoiceAgentKitConfig } from '../types/index.js';

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

const STTConfigSchema = z
  .object({
    provider: z.string().min(1),
    apiKey: z.string().optional(),
    sampleRate: z.number().default(8000),
  })
  .catchall(z.unknown());

const TTSConfigSchema = z
  .object({
    provider: z.string().min(1),
    apiKey: z.string().optional(),
    voice: z.string().optional(),
    speed: z.number().min(0.25).max(4.0).default(1.0),
  })
  .catchall(z.unknown());

const MCPConfigSchema = z.object({
  endpoint: z.string().url(),
  auth: z
    .object({
      type: z.string().min(1),
      credentials: z.record(z.string(), z.string()),
    })
    .optional(),
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

const VADConfigSchema = z
  .object({
    provider: z.enum(['energy', 'none']).default('none'),
    energyThreshold: z.number().min(1.0).max(10.0).optional(),
    silenceTimeoutMs: z.number().min(100).max(10000).optional(),
    minSpeechDurationMs: z.number().min(0).max(5000).optional(),
    maxSpeechDurationMs: z.number().min(1000).max(60000).optional(),
  })
  .optional();

const DTMFConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    interDigitTimeout: z.number().min(500).max(10000).default(2000),
    maxDigits: z.number().min(1).max(32).default(10),
    terminatorDigit: z.string().length(1).optional().default('#'),
  })
  .optional();

const ThinkingAudioConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    strategy: z.enum(['none', 'silence', 'filler', 'backchannel']).default('none'),
    backchannelPhrases: z.array(z.string()).optional().default([]),
    fillerToneHz: z.number().min(100).max(2000).optional().default(440),
    fillerVolume: z.number().min(0).max(1).optional().default(0.1),
    maxDurationMs: z.number().min(100).max(5000).optional().default(800),
  })
  .optional();

const TransportConfigSchema = z
  .object({
    type: z
      .string()
      .refine((v: string): v is TransportType =>
        ['twilio', 'webrtc', 'telnyx', 'signalwire', 'vonage', 'sip'].includes(v),
      )
      .optional(),
    sampleRate: z.number().min(8000).max(48000).optional(),
    channels: z.number().min(1).max(2).optional(),
  })
  .optional();

const SpeechToSpeechConfigSchema = z
  .object({
    provider: z.enum(['openai-realtime', 'gemini-live', 'deepgram-speak']),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    voice: z.string().optional(),
    instructions: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    modalities: z.array(z.enum(['text', 'audio'])).optional(),
    inputAudioFormat: z
      .object({
        sampleRate: z.number().min(8000).max(48000),
        encoding: z.enum(['linear16', 'opus']),
        channels: z.number().min(1).max(2),
      })
      .optional(),
    outputAudioFormat: z
      .object({
        sampleRate: z.number().min(8000).max(48000),
        encoding: z.enum(['linear16', 'opus', 'mulaw']),
        channels: z.number().min(1).max(2),
      })
      .optional(),
    vad: z
      .object({
        threshold: z.number().min(0).max(1).optional(),
        silenceDurationMs: z.number().min(100).max(10000).optional(),
      })
      .optional(),
  })
  .optional();

const RecordingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  storage: z.enum(['memory', 'filesystem', 's3', 'custom']).default('memory'),
  directory: z.string().optional(),
  s3Bucket: z.string().optional(),
  s3Prefix: z.string().optional(),
  saveAudio: z.boolean().default(true),
  saveTranscript: z.boolean().default(true),
  saveEvents: z.boolean().default(false),
  format: z.enum(['wav', 'mp3', 'raw']).default('wav'),
});

const ProviderPricingSchema = z.object({
  stt: z
    .object({
      pricePerMinute: z.number().min(0).optional(),
      pricePerHour: z.number().min(0).optional(),
    })
    .optional(),
  tts: z
    .object({
      pricePerCharacter: z.number().min(0),
      pricePer1k: z.number().min(0).optional(),
    })
    .optional(),
  llm: z
    .object({
      pricePerInputToken: z.number().min(0),
      pricePerOutputToken: z.number().min(0),
    })
    .optional(),
});

const CostTrackingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  currency: z.string().default('USD'),
  providers: z.record(z.string(), ProviderPricingSchema).default(DEFAULT_PRICING),
});

export const VoiceAgentKitConfigSchema = z.object({
  mcp: MCPConfigSchema,
  stt: STTConfigSchema,
  tts: TTSConfigSchema,
  latency: LatencyBudgetSchema,
  session: SessionConfigSchema,
  bargeIn: BargeInConfigSchema,
  mode: z.enum(['staged', 'speech-to-speech']).default('staged'),
  speechToSpeech: SpeechToSpeechConfigSchema,
  vad: VADConfigSchema,
  dtmf: DTMFConfigSchema,
  thinkingAudio: ThinkingAudioConfigSchema,
  transport: TransportConfigSchema,
  recording: RecordingConfigSchema.optional(),
  cost: CostTrackingConfigSchema.optional(),
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
      auth: process.env.MCP_API_KEY
        ? {
            type: 'bearer',
            credentials: { token: process.env.MCP_API_KEY },
          }
        : undefined,
      timeout: process.env.MCP_TIMEOUT ? Number.parseInt(process.env.MCP_TIMEOUT, 10) : 400,
    };
  }

  if (process.env.STT_PROVIDER) {
    envConfig.stt = {
      provider: process.env.STT_PROVIDER,
      apiKey: process.env.STT_API_KEY,
      sampleRate: process.env.STT_SAMPLE_RATE
        ? Number.parseInt(process.env.STT_SAMPLE_RATE, 10)
        : 8000,
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
    mode: 'staged',
    vad: {
      provider: 'none',
    },
    dtmf: {
      enabled: true,
      interDigitTimeout: 2000,
      maxDigits: 10,
      terminatorDigit: '#',
    },
    thinkingAudio: {
      enabled: false,
      strategy: 'none',
      backchannelPhrases: [],
      fillerToneHz: 440,
      fillerVolume: 0.1,
      maxDurationMs: 800,
    },
    transport: {
      type: 'twilio',
      sampleRate: 8000,
      channels: 1,
    },
  };
}
