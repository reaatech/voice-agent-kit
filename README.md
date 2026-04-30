# voice-agent-kit

[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)

> **Transport layer for real-time voice AI agents** — handles the full pipeline from Twilio audio to STT to MCP agent to TTS back to audio, with strict latency budgets and provider-agnostic interfaces.

This monorepo provides the pipeline orchestration, telephony integration, provider adapters, and MCP client needed to build production voice agents. It is the **transport**, not the **brain** — agent logic lives in an MCP server.

## Features

- **<800ms pipeline** — End-to-end latency from end-of-speech to first audio byte with per-stage budgets
- **Provider-agnostic STT** — Deepgram, AWS Transcribe, and Google Cloud Speech-to-Text adapters with a unified interface
- **Provider-agnostic TTS** — Deepgram Aura, AWS Polly, and Google Cloud Text-to-Speech adapters with cancelable streaming
- **MCP client** — JSON-RPC 2.0 client with tool discovery, retry with backoff, and TTS-optimized response sanitization
- **Twilio Media Streams** — Bidirectional WebSocket handler with barge-in detection, mark tracking, and base64 audio encoding
- **Session management** — Multi-turn conversation state with TTL expiry, turn history, and automatic cleanup
- **Latency enforcement** — Per-stage timing with hard caps, overflow detection, and OpenTelemetry metrics
- **Observability** — OpenTelemetry tracing spans, histograms, and counters for every pipeline stage
- **Dual ESM/CJS** — Every package ships both `import` and `require` entry points

## Installation

### Using the packages

Packages are published under the `@reaatech` scope and can be installed individually:

```bash
# Core pipeline, session management, config, and types
pnpm add @reaatech/voice-agent-core

# Speech-to-text provider adapters
pnpm add @reaatech/voice-agent-stt

# Text-to-speech provider adapters
pnpm add @reaatech/voice-agent-tts

# MCP client wrapper
pnpm add @reaatech/voice-agent-mcp-client

# Twilio Media Streams handler
pnpm add @reaatech/voice-agent-telephony
```

### Contributing

```bash
# Clone the repository
git clone https://github.com/reaatech/voice-agent-kit.git
cd voice-agent-kit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the test suite
pnpm test

# Run linting
pnpm lint
```

## Quick Start

Wire up a voice agent pipeline with Deepgram for STT/TTS and a custom MCP endpoint:

```typescript
import { defineConfig, createPipeline, initializeSessionManager, createLatencyBudget, LatencyBudgetEnforcer } from '@reaatech/voice-agent-core';
import { DeepgramSTTProvider } from '@reaatech/voice-agent-stt';
import { DeepgramTTSProvider } from '@reaatech/voice-agent-tts';
import { MCPClient } from '@reaatech/voice-agent-mcp-client';
import { createTwilioHandler } from '@reaatech/voice-agent-telephony';

const config = defineConfig({
  stt: { provider: 'deepgram', apiKey: process.env.DEEPGRAM_API_KEY, sampleRate: 8000 },
  tts: { provider: 'deepgram', apiKey: process.env.DEEPGRAM_API_KEY, voice: 'asteria' },
  mcp: { endpoint: process.env.MCP_ENDPOINT, timeout: 400 },
  latency: { total: { target: 800, hardCap: 1200 }, stages: { stt: 200, mcp: 400, tts: 200 } },
  session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
  bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
});

const pipeline = createPipeline({
  config,
  sessionManager: initializeSessionManager({ defaultTTL: 3600, maxTurns: 20, maxTokens: 4000 }),
  latencyEnforcer: new LatencyBudgetEnforcer(config.latency),
  sttProvider: new DeepgramSTTProvider(),
  ttsProvider: new DeepgramTTSProvider(),
  mcpClient: new MCPClient({ endpoint: config.mcp.endpoint }),
});

// In your WebSocket server:
const handler = createTwilioHandler({ bargeInEnabled: true });
handler.on('audio:received', (chunk) => pipeline.processAudioChunk(sessionId, chunk));
handler.on('barge-in:detected', () => pipeline.bargeIn(sessionId));
pipeline.on('pipeline:tts:chunk', ({ data }) => handler.sendAudio(data.chunk));
```

See the [`examples/`](./examples/) directory for complete working samples, including RAG voice agents, multi-agent orchestration, and minimal echo testing.

## Packages


| Package                                                     | Description                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@reaatech/voice-agent-core`](./packages/core)             | Pipeline orchestrator, session management, latency enforcement, config, and types |
| [`@reaatech/voice-agent-stt`](./packages/stt)               | Speech-to-text provider interface with Deepgram, AWS, and Google adapters         |
| [`@reaatech/voice-agent-tts`](./packages/tts)               | Text-to-speech provider interface with Deepgram, AWS, and Google adapters         |
| [`@reaatech/voice-agent-mcp-client`](./packages/mcp-client) | JSON-RPC 2.0 MCP client with tool discovery and response sanitization             |
| [`@reaatech/voice-agent-telephony`](./packages/telephony)   | Twilio Media Streams WebSocket handler with barge-in detection                    |

## Latency Budget


| Stage     | Budget    | Notes                                                |
| --------- | --------- | ---------------------------------------------------- |
| STT       | 200ms     | Deepgram nova-2 typically delivers well under budget |
| MCP       | 400ms     | Agent round-trip; depends on endpoint complexity     |
| TTS       | 200ms     | Deepgram Aura first-byte is usually under 100ms      |
| **Total** | **800ms** | Hard cap at 1200ms triggers budget-exceeded metrics  |

## Pipeline Flow

```
Twilio WebSocket  →  AudioChunk  →  STT  →  Utterance  →  MCP  →  AgentResponse  →  TTS  →  AudioChunk  →  Twilio
```

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, package relationships, and pipeline internals
- [`AGENTS.md`](./AGENTS.md) — Coding conventions and development guidelines
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contribution workflow, adding providers, and release process
- [`LATENCY_BUDGET.md`](./docs/LATENCY_BUDGET.md) — Per-provider latency characteristics and tuning

## License

[MIT](LICENSE)
