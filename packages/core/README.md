# @reaatech/voice-agent-core

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-core)](https://www.npmjs.com/package/@reaatech/voice-agent-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Core pipeline orchestration, session management, latency enforcement, configuration, and types for building voice-enabled AI agents. Runtime dependencies are limited to `zod` and `uuid`; `@opentelemetry/api` is a peer dependency.

## Installation

```bash
npm install @reaatech/voice-agent-core @opentelemetry/api
pnpm add @reaatech/voice-agent-core @opentelemetry/api
```

`@opentelemetry/api` is a required peer dependency — install it alongside core. It is a tiny, dependency-free package and acts as a no-op when no OpenTelemetry SDK is registered.

## Feature Overview

- **Pipeline orchestrator** — Full STT → MCP → TTS pipeline with event-driven lifecycle
- **Latency budget enforcer** — Per-stage timing with hard caps, overflow detection, and metrics
- **Session manager** — Multi-turn conversation state with TTL expiry and automatic cleanup
- **Transport abstraction** — Pluggable `Transport` interface for multi-provider telephony support
- **Speech-to-speech pipeline** — `SpeechToSpeechPipeline` for OpenAI Realtime / Gemini Live single-hop mode
- **Provider failover** — `CompositeSTTProvider`, `CompositeTTSProvider`, `FailoverManager` with circuit-breaking
- **VAD & endpointing** — Pluggable voice activity detection with energy-based and semantic detectors
- **DTMF input** — Keypad digit accumulation with inter-digit timeout and MCP integration
- **Thinking affordances** — Filler audio during MCP processing to avoid dead air
- **Call recording** — `RecordingManager` with memory/filesystem/S3 storage backends
- **Cost tracking** — `CostTracker` with real pricing for 12 providers and OTel metrics
- **Zod-validated config** — `defineConfig()` with full TypeScript intellisense and runtime validation
- **Observability** — OpenTelemetry tracing spans, histograms, and counters for every stage
- **Mock providers** — Built-in `MockSTTProvider`, `MockTTSProvider`, and `MockMCPClient` for testing
- **50+ exported types** — `AudioChunk`, `Utterance`, `AgentResponse`, `Session`, `Turn`, and more

## Quick Start

```typescript
import { createPipeline, createLatencyBudget, initializeSessionManager } from '@reaatech/voice-agent-core';

const sessionManager = initializeSessionManager({
  defaultTTL: 3600,
  maxTurns: 20,
  maxTokens: 4000,
});

const latencyEnforcer = new LatencyBudgetEnforcer(
  createLatencyBudget({
    target: 800,
    hardCap: 1200,
    stt: 200,
    mcp: 400,
    tts: 200,
  })
);

const pipeline = createPipeline({
  sessionManager,
  latencyEnforcer,
  sttProvider: mySTTProvider,
  ttsProvider: myTTSProvider,
  mcpClient: myMCPClient,
  config: myConfig,
});

await pipeline.startSession({ sessionId: 'abc', status: 'active' });
pipeline.on('pipeline:turn:end', (event) => {
  console.log('Turn complete:', event.data.metrics);
});
```

## API Reference

### Types

| Type | Description |
|------|-------------|
| `AudioChunk` | Raw audio buffer with sample rate, encoding, channels, timestamp |
| `Utterance` | Transcribed text with confidence, isFinal flag, timestamp |
| `AgentResponse` | MCP agent output: text, tool calls, latency |
| `Session` | Multi-turn session with ID, TTL, conversation turns, status |
| `Turn` | Single conversation turn: user utterance, agent response, latency |
| `PipelineEvent` | Typed event from the pipeline with sessionId, turnId, data |
| `LatencyBudget` | Per-stage timing targets and hard caps |
| `VoiceAgentKitConfig` | Complete kit configuration (MCP, STT, TTS, latency, session, barge-in) |
| `Transport` | Pluggable transport layer interface |
| `S2SProvider` | Speech-to-speech provider interface |
| `VADProvider` | Voice activity detection provider interface |
| `RecordingConfig` | Call recording configuration |
| `CostTrackingConfig` | Per-call cost tracking configuration |
| `PipelineMode` | Pipeline mode: 'staged' or 'speech-to-speech' |

### Pipeline

```typescript
class Pipeline extends EventEmitter {
  constructor(dependencies: PipelineDependencies);
  startSession(session: { sessionId: string; status: string }): Promise<void>;
  processAudioChunk(sessionId: string, chunk: AudioChunk): Promise<void>;
  bargeIn(sessionId: string): void;
  endSession(sessionId: string): Promise<void>;
  destroy(): void;
}
```

Pipeline events:

| Event | Description |
|-------|-------------|
| `pipeline:start` | Session started |
| `pipeline:stt:start` | STT processing begun for a turn |
| `pipeline:stt:interim` | Interim (non-final) transcript received |
| `pipeline:stt:final` | Final transcript received |
| `pipeline:stt:eos` | End-of-speech detected |
| `pipeline:mcp:request` | Request sent to MCP server |
| `pipeline:mcp:response` | Response received from MCP server |
| `pipeline:tts:start` | TTS synthesis begun |
| `pipeline:tts:first_byte` | First audio byte emitted from TTS |
| `pipeline:tts:chunk` | Audio chunk emitted |
| `pipeline:tts:complete` | TTS synthesis complete |
| `pipeline:turn:end` | Turn complete with latency metrics |
| `pipeline:error` | Error at any stage |
| `pipeline:end` | Session ended |

### SpeechToSpeechPipeline

For speech-to-speech mode with providers like OpenAI Realtime or Gemini Live:

```typescript
class SpeechToSpeechPipeline extends EventEmitter {
  startSession(session): Promise<void>;
  processAudioChunk(sessionId, chunk): Promise<void>;
  bargeIn(sessionId): void;
  endSession(sessionId): Promise<void>;
}
```

Created via `createPipelineForMode(config)` which automatically selects `SpeechToSpeechPipeline` when `config.mode === 'speech-to-speech'`.

### SessionManager

```typescript
class SessionManager {
  constructor(options: SessionManagerOptions);
  createSession(params: { callSid, mcpEndpoint, sttProvider, ttsProvider, metadata? }): Session;
  getSession(sessionId: string): Session | undefined;
  getSessionByCallSid(callSid: string): Session | undefined;
  updateSession(sessionId: string, updates: Partial<Session>): Session | undefined;
  addTurn(sessionId: string, turn: Omit<Turn, 'turnId'>): Turn | undefined;
  getConversationHistory(sessionId: string, maxTurns?: number): Turn[];
  closeSession(sessionId: string): boolean;
  getActiveSessionCount(): number;
  getAllSessions(): Session[];
  destroy(): void;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultTTL` | `number` | — | Session time-to-live in seconds |
| `maxTurns` | `number` | — | Maximum conversation turns retained per session |
| `maxTokens` | `number` | — | Maximum token budget (for future use) |
| `cleanupInterval` | `number` | `60000` | Interval for expired session cleanup in ms |

### LatencyBudgetEnforcer

```typescript
class LatencyBudgetEnforcer extends EventEmitter {
  constructor(budget: LatencyBudget);
  startTurn(turnId: string): void;
  startStage(turnId: string, stage: string): void;
  endStage(turnId: string, stage: string): number;
  endTurn(turnId: string): LatencyMetrics;
  checkStageBudget(stage, elapsedMs): { withinBudget, remainingMs, exceeded };
  checkTotalBudget(elapsedMs): { withinTarget, withinHardCap, remainingTargetMs, remainingHardCapMs };
  getStageBudget(stage: 'stt' | 'mcp' | 'tts'): number;
  getTotalTargetBudget(): number;
  getTotalHardCap(): number;
}
```

Latency budget defaults:

| Stage | Target |
|-------|--------|
| STT | 200ms |
| MCP | 400ms |
| TTS | 200ms |
| **Total** | **800ms** (hard cap 1200ms) |

### Configuration

```typescript
import { defineConfig, loadConfig, getDefaultConfig, VoiceAgentKitConfigSchema } from '@reaatech/voice-agent-core';

const config = defineConfig({
  mcp: {
    endpoint: 'https://my-agent.example.com/mcp',
    timeout: 400,
  },
  stt: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en',
    sampleRate: 8000,
  },
  tts: {
    provider: 'deepgram',
    voice: 'asteria',
    model: 'aura',
  },
  latency: {
    total: { target: 800, hardCap: 1200 },
    stages: { stt: 200, mcp: 400, tts: 200 },
  },
  session: {
    ttl: 3600,
    history: { maxTurns: 20, maxTokens: 4000 },
  },
  bargeIn: {
    enabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  },
});
```

### Observability

```typescript
import { initializeObservability, getObservability, shutdownObservability } from '@reaatech/voice-agent-core';

await initializeObservability({
  serviceName: 'voice-agent-kit',
  serviceVersion: '1.0.0',
  enabled: true,
  otlpEndpoint: 'http://localhost:4318/v1/traces',
});

const obs = getObservability();
const span = obs.startSpan('voice.stt', { sessionId, provider: 'deepgram' });
```

OpenTelemetry metrics exported:

| Metric | Type | Description |
|--------|------|-------------|
| `voice.turn.duration_ms` | Histogram | End-to-end turn latency |
| `voice.stt.latency_ms` | Histogram | Time to final transcript |
| `voice.tts.first_byte_ms` | Histogram | Time to first audio byte |
| `voice.mcp.latency_ms` | Histogram | MCP round-trip time |
| `voice.barge_in.count` | Counter | Barge-in event count |
| `voice.session.active` | UpDownCounter | Active session count |
| `voice.latency_budget.exceeded` | Counter | Budget exceeded per stage |
| `voice.cost.per_turn` | Histogram | Per-turn cost in cents |
| `voice.cost.total` | Counter | Cumulative cost |
| `voice.cost.per_minute` | Gauge | Cost rate per minute |

### Transport

```typescript
import type { Transport, TransportConfig, TransportSessionMetadata } from '@reaatech/voice-agent-core';
```

The `Transport` interface abstracts telephony/browser transport providers. Implementations exist for Twilio, Telnyx, SignalWire, Vonage, and WebRTC.

### VAD & Endpointing

```typescript
import { createVADProvider, EnergyVADProvider, SemanticEndpointDetector } from '@reaatech/voice-agent-core';

const vad = createVADProvider({ provider: 'energy', silenceTimeoutMs: 500 });
```

| Provider | Description |
|----------|-------------|
| `EnergyVADProvider` | RMS-based energy detection with adaptive noise floor |
| `SemanticEndpointDetector` | Wraps any VAD with utterance-aware endpoint detection |

### Recording

```typescript
import { createRecordingManager } from '@reaatech/voice-agent-core';

const recording = createRecordingManager({
  enabled: true,
  storage: 'filesystem',
  directory: './recordings',
  saveAudio: true,
  saveTranscript: true,
});
```

| Storage | Description |
|---------|-------------|
| `memory` | In-memory storage with LRU eviction |
| `filesystem` | Saves WAV + markdown transcript + JSON metadata to disk |
| `s3` | Uploads to S3 (requires @aws-sdk/client-s3) |

### Cost Tracking

```typescript
import { createCostTracker } from '@reaatech/voice-agent-core';

const cost = createCostTracker({
  enabled: true,
  currency: 'USD',
  providers: {
    deepgram: { stt: { pricePerMinute: 0.0059 }, tts: { pricePerCharacter: 0.000015 } },
  },
});

cost.trackSTTUsage(sessionId, turnId, audioDurationMs);
cost.trackTTSUsage(sessionId, turnId, characterCount);
const sessionCost = cost.getSessionCost(sessionId);
```

### Mock Providers

```typescript
import {
  MockSTTProvider,
  MockTTSProvider,
  MockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
  createMockMCPClient,
} from '@reaatech/voice-agent-core';
```

Pre-built mock implementations for testing pipelines without live provider connections. MockSTT emits configurable utterances, MockTTS yields fake audio chunks, MockMCPClient returns canned responses.

## Related Packages

- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text providers
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech providers
- [@reaatech/voice-agent-mcp-client](https://www.npmjs.com/package/@reaatech/voice-agent-mcp-client) — MCP client wrapper
- [@reaatech/voice-agent-telephony](https://www.npmjs.com/package/@reaatech/voice-agent-telephony) — Twilio Media Streams handler
- [@reaatech/voice-agent-webrtc](https://www.npmjs.com/package/@reaatech/voice-agent-webrtc) — WebRTC browser transport
- [@reaatech/voice-agent-simulator](https://www.npmjs.com/package/@reaatech/voice-agent-simulator) — Local development simulator

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
