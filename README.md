# voice-agent-kit

[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)

> **Transport layer for real-time voice AI agents** — handles the full pipeline from Twilio audio to STT to MCP agent to TTS back to audio, with strict latency budgets and provider-agnostic interfaces.

This monorepo provides the pipeline orchestration, telephony integration, provider adapters, and MCP client needed to build production voice agents. It is the **transport**, not the **brain** — agent logic lives in an MCP server.

## Features

- **<800ms pipeline** — End-to-end latency from end-of-speech to first audio byte with per-stage budgets
- **Transport interface abstraction** — Unified transport layer supports Twilio, WebRTC, and arbitrary WebSocket transports
- **WebRTC browser transport** — Direct browser-to-agent audio with Opus codec support, no phone number required
- **Provider-agnostic STT** — 11 adapters: Deepgram, OpenAI Realtime/Whisper, AssemblyAI, Groq Whisper, AWS Transcribe, Google Cloud Speech-to-Text, plus mock providers for development/testing
- **Provider-agnostic TTS** — 6 adapters: Deepgram Aura, ElevenLabs, Cartesia, AWS Polly, Google Cloud Text-to-Speech, plus mock providers
- **Speech-to-speech pipeline mode** — Bypass the staged pipeline for direct audio-to-audio via OpenAI Realtime or Gemini Live
- **Multi-provider failover** — Circuit breaking, health tracking, and automatic failover across STT/TTS providers
- **Pluggable VAD** — Configurable voice activity detection with DTMF input support and thinking affordances
- **Call recording & cost tracking** — Record calls to disk/S3 with per-session cost attribution and Grafana dashboards
- **Local simulator** — Develop and test voice agents without a phone number or cloud credentials
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
npm install @reaatech/voice-agent-core        # or: pnpm add / yarn add

# Speech-to-text provider adapters
npm install @reaatech/voice-agent-stt

# Text-to-speech provider adapters
npm install @reaatech/voice-agent-tts

# MCP client wrapper
npm install @reaatech/voice-agent-mcp-client

# Twilio Media Streams handler
npm install @reaatech/voice-agent-telephony

# WebRTC browser transport
npm install @reaatech/voice-agent-webrtc

# Local development simulator
npm install @reaatech/voice-agent-simulator

# Project scaffolding CLI
npm install @reaatech/create-voice-agent
```

> `@reaatech/voice-agent-core` requires `@opentelemetry/api` as a peer dependency for
> tracing and metrics — install it alongside core:
>
> ```bash
> npm install @opentelemetry/api
> ```

#### Provider SDKs (install only what you use)

The cloud STT/TTS adapters load their provider SDKs lazily and declare them as
**optional peer dependencies**, so you only install the SDK for the provider you
actually use. Deepgram, ElevenLabs, Cartesia, and OpenAI use HTTP and need no extra SDKs.

```bash
# AWS Polly (TTS) / AWS Transcribe (STT)
npm install @aws-sdk/client-polly @aws-sdk/client-transcribe-streaming @aws-sdk/credential-provider-ini

# Google Cloud Text-to-Speech (TTS) / Speech-to-Text (STT)
npm install @google-cloud/text-to-speech @google-cloud/speech
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

> **Fastest path**: `npx @reaatech/create-voice-agent` scaffolds a complete project. See [`examples/quickstart/`](./examples/quickstart/) for a ready-to-run server with Twilio webhook handling, health checks, and more.

Wire up a voice agent pipeline with Deepgram for STT/TTS and a custom MCP endpoint:

```typescript
import { defineConfig, createPipeline } from '@reaatech/voice-agent-core';
import { DeepgramSTTProvider } from '@reaatech/voice-agent-stt';
import { DeepgramTTSProvider } from '@reaatech/voice-agent-tts';
import { MCPClient } from '@reaatech/voice-agent-mcp-client';

const config = defineConfig({
  stt: { provider: 'deepgram', apiKey: process.env.DEEPGRAM_API_KEY },
  tts: { provider: 'deepgram', apiKey: process.env.DEEPGRAM_API_KEY, voice: 'asteria' },
  mcp: { endpoint: process.env.MCP_ENDPOINT, timeout: 400 },
});

const pipeline = createPipeline({
  config,
  sttProvider: new DeepgramSTTProvider(),
  ttsProvider: new DeepgramTTSProvider(),
  mcpClient: new MCPClient({ endpoint: config.mcp.endpoint }),
});
```

> For a complete runnable server, see [`examples/quickstart/`](./examples/quickstart/) which includes Twilio webhook handling, health checks, and more.
>
> See the [`examples/`](./examples/) directory for additional samples, including RAG voice agents, multi-agent orchestration, and minimal echo testing.

## Packages


| Package                                                     | Description                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@reaatech/voice-agent-core`](./packages/core)             | Pipeline orchestrator, session management, latency enforcement, config, and types |
| [`@reaatech/voice-agent-stt`](./packages/stt)               | Speech-to-text provider interface with 11 adapters: Deepgram, OpenAI, AssemblyAI, Groq, AWS, Google, and more |
| [`@reaatech/voice-agent-tts`](./packages/tts)               | Text-to-speech provider interface with 6 adapters: Deepgram, ElevenLabs, Cartesia, AWS, Google, and more |
| [`@reaatech/voice-agent-mcp-client`](./packages/mcp-client) | JSON-RPC 2.0 MCP client with tool discovery and response sanitization             |
| [`@reaatech/voice-agent-telephony`](./packages/telephony)   | Multi-provider telephony handler (Twilio, Telnyx, SignalWire, Vonage) with barge-in detection |
| [`@reaatech/voice-agent-webrtc`](./packages/webrtc)         | WebRTC browser transport with Opus codec support                                  |
| [`@reaatech/voice-agent-simulator`](./packages/simulator)   | Local dev runner for testing voice agents without a phone number or cloud creds   |
| [`@reaatech/create-voice-agent`](./packages/create-voice-agent) | Project scaffolding CLI to bootstrap new voice agent projects                   |

## Latency Budget


| Stage     | Budget    | Notes                                                |
| --------- | --------- | ---------------------------------------------------- |
| STT       | 200ms     | Deepgram nova-2 typically delivers well under budget |
| MCP       | 400ms     | Agent round-trip; depends on endpoint complexity     |
| TTS       | 200ms     | Deepgram Aura first-byte is usually under 100ms      |
| **Total** | **800ms** | Hard cap at 1200ms triggers budget-exceeded metrics  |

## Pipeline Flow

```
Staged:  Twilio/WebRTC WebSocket → AudioChunk → STT → Utterance → MCP → AgentResponse → TTS → AudioChunk → Transport
S2S:     Transport WebSocket → AudioChunk → S2S Provider (OpenAI/Gemini) → AudioChunk → Transport
```

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, package relationships, and pipeline internals
- [`AGENTS.md`](./AGENTS.md) — Coding conventions and development guidelines
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contribution workflow, adding providers, and release process
- [`LATENCY_BUDGET.md`](./docs/LATENCY_BUDGET.md) — Per-provider latency characteristics and tuning
- [`infra/grafana/README.md`](./infra/grafana/README.md) — Grafana dashboard for pipeline metrics and cost tracking

## License

[MIT](LICENSE)
