# Architecture — voice-agent-kit

## Overview

voice-agent-kit is a **transport layer** for real-time voice AI agents. It handles the complete pipeline from telephony audio to agent response and back, with strict latency budgets and provider-agnostic interfaces.

## What This Repo Owns

- **Pipeline orchestration** — STT → MCP → TTS flow with typed events
- **Provider interfaces** — Pluggable STT, TTS, and MCP adapters
- **Latency enforcement** — Budget tracking and per-stage timeouts
- **Session management** — Multi-turn context, TTL, cleanup
- **Telephony integration** — Twilio Media Streams WebSocket handler
- **Transport abstraction** — Pluggable transport layer (Twilio, WebRTC, Telnyx, SignalWire, Vonage)
- **Speech-to-speech pipeline** — Alternative single-hop S2S mode (OpenAI Realtime, Gemini Live)
- **VAD & turn-taking** — Pluggable voice activity detection, DTMF input, thinking affordances
- **Configuration** — Zod-validated, env-driven config

## What This Repo Does NOT Own

- **Agent logic** — The MCP server is the "brain"; this is just the transport
- **Built-in RAG** — Use an MCP server like `hybrid-rag-qdrant` for that
- **SIP trunking** — Twilio abstracts this; direct SIP is out of scope
- **Voiceprint/speaker ID** — Interesting but scope creep

## Pipeline Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                     Transport Interface (pluggable)                     │
│   acceptConnection() · sendAudio() · clearAudio() · getSessionId()     │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
     ┌──────────┬──────────┬────┴─────┬──────────┬──────────┐
     ▼          ▼          ▼          ▼          ▼          ▼
┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐
│ Twilio  ││ Telnyx  ││SignalWire││ Vonage  ││ WebRTC  ││ Custom  │
│(mulaw)  ││(mulaw)  ││(mulaw)  ││(mulaw)  ││ (l16)   ││         │
└────┬────┘└────┬────┘└────┬────┘└────┬────┘└────┬────┘└────┬────┘
     └──────────┴──────────┴──────────┴──────────┴──────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│    Staged Pipeline Path       │  │   Speech-to-Speech Path       │
│                               │  │                               │
│  Audio → STT → Utterance →    │  │  Audio → S2S Provider →       │
│  MCP → Text → TTS → Audio     │  │  Audio (single-hop)           │
│                               │  │                               │
│  Per-stage events & metrics   │  │  OpenAI Realtime · Gemini Live │
│  Configurable LLM via MCP     │  │  Direct audio I/O             │
└───────────────┬───────────────┘  └───────────────┬───────────────┘
                │                                  │
                ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│      Pipeline Orchestrator    │  │       S2S Provider Bridge      │
│  Typed events · Latency track │  │  Transcript callbacks          │
│  Error propagation · Barge-in │  │  Audio chunk routing           │
└───────────────┬───────────────┘  └───────────────────────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌─────────┐┌─────────┐┌─────────┐
│   STT   ││   MCP   ││   TTS   │
│         ││  Client ││         │
│•Deepgram││         ││•Deepgram│
│•OpenAI  ││ Connects││•11Labs  │
│•Assmbly ││  to any ││•Cartesia│
│•AWS     ││   MCP   ││•AWS     │
│•Google  ││  server ││•Google  │
│•Groq    ││         ││         │
└─────────┘└─────────┘└─────────┘
```

## Provider Interface Contracts

### STT Provider

```typescript
interface STTProvider {
  readonly name: string;
  connect(config: STTConfig): Promise<void>;
  streamAudio(chunk: AudioChunk): void;
  onUtterance(cb: (utterance: Utterance) => void): void;
  onEndOfSpeech(cb: () => void): void;
  close(): Promise<void>;
}
```

### TTS Provider

```typescript
interface TTSProvider {
  readonly name: string;
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>;
  readonly supportsStreaming: boolean;
  readonly firstByteLatencyMs: number | null;
  cancel(): void;
}
```

### MCP Client

```typescript
interface MCPClient {
  connect(): Promise<void>;
  sendRequest(params: MCPRequestParams): Promise<MCPResponse>;
  discoverTools(): Promise<MCPTool[]>;
  close(): Promise<void>;
}
```

### Transport

```typescript
interface Transport extends EventEmitter {
  readonly name: string;
  acceptConnection(connection: unknown): Promise<void>;
  sendAudio(chunk: AudioChunk): void;
  clearAudio(): Promise<void>;
  getSessionId(): string | null;
  close(): Promise<void>;
}
```

### S2S Provider

```typescript
interface S2SProvider {
  readonly name: string;
  connect(config: SpeechToSpeechConfig): Promise<void>;
  sendAudio(chunk: AudioChunk): void;
  onAudioOutput(cb: (chunk: AudioChunk) => void): void;
  onTranscript(cb: (utterance: Utterance) => void): void;
  close(): Promise<void>;
}
```

## Latency Budget

Default total budget: **800ms target, 1200ms hard cap**

| Stage | Budget | Notes |
|-------|--------|-------|
| STT (final transcript) | 200ms | Deepgram Nova-2 typical: 100-150ms |
| MCP round-trip | 400ms | Configurable per MCP server |
| TTS first byte | 200ms | Deepgram Aura typical: 100-150ms |

When budget is exceeded:
1. Warning logged with stage label
2. Metric emitted (`voice.latency_budget.exceeded`)
3. Optional fallback response (configurable)

## Session Management

- **TTL** — Configurable (default 1h), auto-cleanup on expiry
- **History** — Last N turns or token budget (configurable)
- **Context** — Per-session metadata, passed to MCP each turn
- **Cleanup** — Resource release, event emission on close

## Configuration

```typescript
// voice-agent-kit.config.ts
export default {
  stt: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en',
  },
  tts: {
    provider: 'deepgram',
    voice: 'asteria',
  },
  mcp: {
    endpoint: process.env.MCP_ENDPOINT,
    timeout: 400,
    retryAttempts: 1,
  },
  latency: {
    totalBudgetMs: 800,
    perStage: {
      stt: 200,
      mcp: 400,
      tts: 200,
    },
  },
  session: {
    ttlSeconds: 3600,
    maxHistoryTurns: 20,
  },
};
```

## Observability

- **OpenTelemetry** spans per stage (`voice.stt`, `voice.mcp`, `voice.tts`)
- **Metrics**: turn duration, per-stage latency, barge-in count, active sessions, cost
- **Structured logging**: JSON logs correlated by session ID and trace ID
- **Exporters**: OTLP (Jaeger, Phoenix, Langfuse), CloudWatch

## Deployment

- **Docker** — Multi-stage build, non-root user
- **AWS** — ECS Fargate, ALB, Secrets Manager, CloudWatch
- **GCP** — Cloud Run, Secret Manager, Cloud Trace

## Monorepo Structure

```
voice-agent-kit/
├── packages/
│   ├── core/              # Pipeline, session, latency, config, types
│   ├── stt/               # STT provider interface + adapters
│   ├── tts/               # TTS provider interface + adapters
│   ├── mcp-client/        # MCP client wrapper
│   ├── telephony/         # Transport adapters (Twilio, Telnyx, etc.)
│   ├── webrtc/            # WebRTC browser client transport
│   ├── simulator/         # Voice agent testing simulator
│   └── create-voice-agent/ # Project scaffolding CLI
├── infra/
│   ├── aws/               # ECS Terraform
│   ├── gcp/               # Cloud Run Terraform
│   └── grafana/           # Observability dashboards
├── examples/
│   ├── hybrid-rag-qdrant/
│   ├── agent-mesh/
│   └── quickstart/
├── skills/                # Agent development skills
└── docs/
    └── LATENCY_BUDGET.md
```
