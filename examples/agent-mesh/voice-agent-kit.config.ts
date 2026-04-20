import { defineConfig } from '@voice-agent-kit/core';

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
    endpoint: process.env.MCP_ENDPOINT || 'http://localhost:8081/api/v1/generate',
    timeout: 500,
    retryAttempts: 1,
    maxHistoryTurns: 30,
  },
  latency: {
    total: {
      target: 1000,
      hardCap: 1400,
    },
    stages: {
      stt: 200,
      mcp: 600,
      tts: 200,
    },
  },
  session: {
    ttl: 3600,
    history: {
      maxTurns: 30,
      maxTokens: 8000,
    },
  },
  bargeIn: {
    enabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  },
});