import { defineConfig } from '@reaatech/voice-agent-core';

export default defineConfig({
  stt: {
    provider: 'deepgram',
    apiKey: process.env.DEEPGRAM_API_KEY,
    sampleRate: 8000,
    model: 'nova-2',
    language: 'en',
    smartFormat: true,
    punctuation: true,
    interimResults: true,
    endpointing: 300,
  },
  tts: {
    provider: 'deepgram',
    apiKey: process.env.DEEPGRAM_API_KEY,
    voice: 'asteria',
    model: 'aura',
    encoding: 'mulaw' as const,
    sampleRate: 8000,
  },
  mcp: {
    endpoint: process.env.MCP_ENDPOINT || 'http://localhost:3001/api/v1/generate',
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
});
