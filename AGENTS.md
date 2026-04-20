---
agent_id: "voice-agent-kit"
display_name: "Voice Agent Kit"
version: "0.1.0"
description: "Toolkit for building voice-enabled AI agents"
type: "mcp"
confidence_threshold: 0.9
---

# AGENTS.md — voice-agent-kit

## Project Overview

voice-agent-kit is a **transport layer** for real-time voice AI agents. It handles the complete pipeline from telephony audio → STT → MCP agent → TTS → audio output, with strict latency budgets and provider-agnostic interfaces.

**Key positioning**: This is the *transport*, not the *brain*. The MCP server is the brain.

## Quick Start

```bash
# Install
pnpm install

# Copy environment
cp .env.example .env
# Edit .env with your Deepgram, Twilio, and MCP endpoint

# Development
pnpm dev

# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

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
│   ├── aws/          # ECS Fargate Terraform
│   └── gcp/          # Cloud Run Terraform
├── examples/
│   ├── hybrid-rag-qdrant/
│   ├── agent-mesh/
│   └── minimal-echo/
├── skills/           # Agent development skills
├── docs/
│   └── LATENCY_BUDGET.md
└── docker/
    └── Dockerfile
```

## Core Concepts

### Pipeline Flow

```
Twilio WebSocket → AudioChunk → STT → Utterance → MCP → AgentResponse → TTS → AudioChunk → Twilio
```

### Key Types

- **AudioChunk** — Raw PCM/mulaw buffer with sample rate, encoding, timestamp
- **Utterance** — Transcript text, confidence, is_final, timestamp
- **AgentResponse** — Text response, tool calls, latency, session context
- **Session** — Multi-turn conversation state with TTL and history

### Latency Budget

| Stage | Budget |
|-------|--------|
| STT | 200ms |
| MCP | 400ms |
| TTS | 200ms |
| **Total** | **800ms** |

## Agent Skills

The following skills are available for agent development:

### Pipeline Skills

- **pipeline-orchestration** — Build and manage the STT → MCP → TTS pipeline
- **latency-budget** — Track and enforce latency budgets per stage
- **session-management** — Create, update, and clean up voice sessions

### Provider Skills

- **stt-provider-interface** — Implement new STT providers (Deepgram, AWS, Google)
- **tts-provider-interface** — Implement new TTS providers (Deepgram, AWS, Google)
- **audio-format-conversion** — Convert between mulaw, linear16, and resampling

### Telephony Skills

- **twilio-media-streams** — Handle Twilio WebSocket messages and audio
- **telephony-lifecycle** — Complete call lifecycle (connect, transfer, disconnect, DTMF)
- **barge-in-handling** — Detect and handle user interruption during TTS

### MCP Skills

- **mcp-client-integration** — Connect to any MCP server endpoint
- **conversation-history** — Manage multi-turn context for MCP requests
- **response-sanitization** — Clean MCP responses for TTS (strip SSML, markdown)

## TypeScript & Lint Rules

- **Strict mode** — `strict: true` in tsconfig.json
- **No implicit any** — All types must be explicit
- **ESLint** — See `eslint.config.mjs` for rules
- **Prettier** — See `.prettierrc` for formatting

### Key ESLint Rules

- `@typescript-eslint/no-explicit-any` — error
- `@typescript-eslint/no-unused-vars` — error
- `no-console` — warn (except in dev/test)
- `prefer-const` — error

## Test Coverage

- **Core package** — ≥90% coverage required
- **Provider packages** — ≥80% coverage required
- **Integration tests** — Full pipeline happy path

```bash
# Run all tests
pnpm test

# Coverage report
pnpm test:coverage

# Specific package
pnpm --filter @voice-agent-kit/core test
```

## Configuration

Configuration is loaded from `voice-agent-kit.config.ts` with environment variable overrides:

```typescript
import { defineConfig } from '@voice-agent-kit/core';

export default defineConfig({
  stt: { provider: 'deepgram', model: 'nova-2' },
  tts: { provider: 'deepgram', voice: 'asteria' },
  mcp: { endpoint: process.env.MCP_ENDPOINT || 'http://localhost:3000/mcp' },
  latency: {
    total: { target: 800, hardCap: 1200 },
    stages: { stt: 200, mcp: 400, tts: 200 },
  },
  session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
  bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
});
```

## Deployment

### Docker

```bash
docker build -t voice-agent-kit .
docker run -p 3000:3000 --env-file .env voice-agent-kit
```

### AWS (ECS Fargate)

```bash
cd infra/aws
terraform init
terraform plan -var="docker_image_uri=..." -var="vpc_id=..." -var="subnets=[...]"
terraform apply
```

### GCP (Cloud Run)

```bash
cd infra/gcp
terraform init
terraform plan -var="project_id=..." -var="docker_image_url=..."
terraform apply
```

## What This Repo Owns vs. Doesn't

### Owns
- Pipeline orchestration
- Provider interfaces
- Latency enforcement
- Session management
- Twilio integration
- Configuration

### Does NOT Own
- Agent logic (MCP server handles this)
- Built-in RAG (use hybrid-rag-qdrant MCP server)
- SIP trunking (Twilio abstracts this)
- WebRTC browser clients
- Voiceprint/speaker ID

## Common Tasks

### Add a New STT Provider

1. Create `packages/stt/src/adapters/your-provider.ts`
2. Implement `STTProvider` interface
3. Add tests in `packages/stt/tests/`
4. Update factory in `packages/stt/src/factory.ts`

### Add a New TTS Provider

1. Create `packages/tts/src/adapters/your-provider.ts`
2. Implement `TTSProvider` interface
3. Add tests in `packages/tts/tests/`
4. Update factory in `packages/tts/src/factory.ts`

### Update Latency Budget

Edit `packages/core/src/latency/index.ts` and update `LATENCY_BUDGET.md`.

## Troubleshooting

### High Latency

1. Check `voice.latency_budget.exceeded` metrics
2. Review per-stage latency in logs
3. Consider increasing MCP timeout
4. Use Deepgram for both STT/TTS (fastest)

### Audio Quality Issues

1. Verify audio format (mulaw 8kHz for Twilio)
2. Check sample rate conversion
3. Ensure proper encoding/decoding

### Connection Issues

1. Verify WebSocket connection to Twilio
2. Check API keys in environment
3. Review firewall/security group rules

## Resources

- **ARCHITECTURE.md** — Detailed architecture and pipeline diagram
- **LATENCY_BUDGET.md** — Per-provider latency characteristics and tuning
- **CONTRIBUTING.md** — How to add providers and Terraform targets
- **DEV_PLAN.md** — Development checklist and roadmap
