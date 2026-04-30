import { defineConfig } from '@reaatech/voice-agent-core';

export default defineConfig({
  stt: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en',
    smartFormat: true,
    punctuation: true,
    interimResults: true,
    endpointing: 300,
  },
  tts: {
    provider: 'deepgram',
    voice: 'asteria',
    model: 'aura',
  },
  mcp: {
    endpoint: process.env.MCP_ENDPOINT || 'http://localhost:3001/api/v1/generate',
    timeout: 200,
    retryAttempts: 0,
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
      maxTurns: 10,
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
