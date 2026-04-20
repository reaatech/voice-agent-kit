# Architecture — voice-agent-kit

## Overview

voice-agent-kit is a **transport layer** for real-time voice AI agents. It handles the complete pipeline from telephony audio to agent response and back, with strict latency budgets and provider-agnostic interfaces.

## What This Repo Owns

- **Pipeline orchestration** — STT → MCP → TTS flow with typed events
- **Provider interfaces** — Pluggable STT, TTS, and MCP adapters
- **Latency enforcement** — Budget tracking and per-stage timeouts
- **Session management** — Multi-turn context, TTL, cleanup
- **Telephony integration** — Twilio Media Streams WebSocket handler
- **Configuration** — Zod-validated, env-driven config

## What This Repo Does NOT Own

- **Agent logic** — The MCP server is the "brain"; this is just the transport
- **Built-in RAG** — Use an MCP server like `hybrid-rag-qdrant` for that
- **SIP trunking** — Twilio abstracts this; direct SIP is out of scope
- **WebRTC browser clients** — Different transport, different repo
- **Voiceprint/speaker ID** — Interesting but scope creep

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Twilio Media Stream                          │
│                    (WebSocket, mulaw 8kHz audio)                     │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TwilioMediaStreamHandler                          │
│  - Parse start/media/stop/mark/DTMF messages                        │
│  - Extract audio payload (base64 mulaw)                              │
│  - Send outbound audio back                                          │
│  - Handle barge-in (clear + cancel TTS)                              │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Pipeline Orchestrator                        │
│  AudioChunk → STT → Utterance → MCP → AgentResponse → TTS → Audio   │
│                                                                       │
│  Each stage is an async generator/transform stream with:             │
│  - Typed events (pipeline:stt:start, pipeline:mcp:response, etc.)    │
│  - Latency tracking                                                   │
│  - Error propagation                                                  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  STTProvider  │    │   MCPClient   │    │  TTSProvider  │
│               │    │               │    │               │
│ • Deepgram    │    │ • Connects to │    │ • Deepgram    │
│ • AWS Trans.  │    │   any MCP     │    │ • AWS Polly   │
│ • Google STT  │    │   server      │    │ • Google TTS  │
└───────────────┘    └───────────────┘    └───────────────┘
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
- **Metrics**: turn duration, per-stage latency, barge-in count, active sessions
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
│   ├── core/         # Pipeline, session, latency, config, types
│   ├── stt/          # STT provider interface + adapters
│   ├── tts/          # TTS provider interface + adapters
│   ├── mcp-client/   # MCP client wrapper
│   └── telephony/    # Twilio Media Streams handler
├── infra/
│   ├── aws/          # ECS Terraform
│   └── gcp/          # Cloud Run Terraform
├── docker/
│   └── Dockerfile
├── examples/
│   ├── hybrid-rag-qdrant/
│   └── agent-mesh/
├── skills/           # Agent development skills
└── docs/
    └── LATENCY_BUDGET.md
