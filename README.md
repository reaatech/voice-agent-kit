# voice-agent-kit

> **Transport layer for real-time voice AI agents**

A production-ready toolkit for building voice agents with strict latency budgets, provider-agnostic interfaces, and seamless MCP integration.

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.3-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/voice-agent-kit.git
cd voice-agent-kit
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run
pnpm dev
```

## What It Does

voice-agent-kit handles the complete pipeline from **Twilio phone call → speech-to-text → AI agent → text-to-speech → audio response**, with:

- **<800ms latency** from end-of-speech to first audio byte
- **Pluggable providers** (Deepgram, AWS, Google for STT/TTS)
- **MCP integration** — connect to any MCP server for agent logic
- **Barge-in support** — users can interrupt the agent mid-sentence
- **Production deployments** — Docker, AWS ECS, GCP Cloud Run

## What It Doesn't Do

- **Agent logic** — The MCP server is the "brain"; this is just the transport
- **Built-in RAG** — Use an MCP server like `hybrid-rag-qdrant` for that
- **SIP trunking** — Twilio abstracts this
- **WebRTC** — Different transport, different repo

## Architecture

```
┌─────────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│   Twilio    │───▶│   STT   │───▶│   MCP   │───▶│   TTS   │───▶│ Twilio  │
│  WebSocket  │    │(Deepgram)│   │ Client  │    │(Deepgram)│    │Response │
└─────────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                        │              │              │
                   200ms budget   400ms budget   200ms budget
```

## Project Structure

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
│   ├── hybrid-rag-qdrant/  # RAG voice agent
│   ├── agent-mesh/         # Multi-agent orchestration
│   └── minimal-echo/       # Simple echo test
├── docs/
│   └── LATENCY_BUDGET.md   # Per-provider latency guide
└── skills/           # Agent development skills
```

## Provider Matrix

| Provider | STT | TTS | Notes |
|----------|-----|-----|-------|
| Deepgram | ✅ | ✅ | Fastest, recommended |
| AWS Transcribe/Polly | 🔄 | 🔄 | Interface ready |
| Google Cloud | 🔄 | 🔄 | Interface ready |

✅ = Implemented | 🔄 = Interface ready, adapter TODO

## Configuration

```typescript
// voice-agent-kit.config.ts
import { defineConfig } from '@voice-agent-kit/core';

export default defineConfig({
  stt: { provider: 'deepgram', sampleRate: 8000, model: 'nova-2', language: 'en' },
  tts: { provider: 'deepgram', voice: 'asteria' },
  mcp: { endpoint: process.env.MCP_ENDPOINT ?? 'http://localhost:3000/mcp', timeout: 400 },
  latency: {
    total: { target: 800, hardCap: 1200 },
    stages: { stt: 200, mcp: 400, tts: 200 },
  },
  session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
  bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
});
```

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Check types
pnpm typecheck

# Lint
pnpm lint
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
terraform apply -var="docker_image_uri=..." -var="vpc_id=..." -var="subnets=[...]"
```

### GCP (Cloud Run)

```bash
cd infra/gcp
terraform init
terraform apply -var="project_id=..." -var="docker_image_url=..."
```

## Examples

### Minimal Echo

Verify your pipeline works with a simple echo agent:

```bash
cd examples/minimal-echo
# Follow README.md instructions
```

### Hybrid RAG + Qdrant

Build a voice agent with RAG capabilities:

```bash
cd examples/hybrid-rag-qdrant
# Follow README.md instructions
```

### Agent Mesh

Multi-agent voice interactions:

```bash
cd examples/agent-mesh
# Follow README.md instructions
```

## Latency Budget

| Stage | Budget | Typical P50 |
|-------|--------|-------------|
| STT | 200ms | 100ms |
| MCP | 400ms | 200ms |
| TTS | 200ms | 100ms |
| **Total** | **800ms** | **400ms** |

See [LATENCY_BUDGET.md](docs/LATENCY_BUDGET.md) for per-provider characteristics.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Adding new STT/TTS adapters
- Adding new Terraform targets
- Provider interface compliance tests

## License

MIT
