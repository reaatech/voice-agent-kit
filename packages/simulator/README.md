# @reaatech/voice-agent-simulator

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-simulator)](https://www.npmjs.com/package/@reaatech/voice-agent-simulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Local simulator and CLI dev runner for the voice agent pipeline. Pipes a WAV
file or live microphone input through **STT → MCP → TTS** and reports per-turn
latency — no Twilio, phone number, or cloud telephony required.

## Installation

```bash
npm install --save-dev @reaatech/voice-agent-simulator
pnpm add -D @reaatech/voice-agent-simulator
```

Or run without installing:

```bash
npx @reaatech/voice-agent-simulator file --input ./sample.wav
```

## CLI

```bash
voice-agent-simulator <command> [options]
```

### `file` — run against a WAV file

```bash
voice-agent-simulator file \
  --input ./sample.wav \
  --stt deepgram --tts deepgram \
  --mcp mock \
  --output ./response.wav \
  --verbose
```

### `mic` — run against live microphone input

```bash
voice-agent-simulator mic --stt deepgram --tts deepgram --mcp mock
```

### Common options

| Option | Description |
|--------|-------------|
| `-m, --mcp <endpoint>` | MCP endpoint URL or `mock` (default: `mock`) |
| `-o, --output <path>` | Write TTS audio to a WAV file |
| `-c, --config <path>` | Path to a `voice-agent-kit.config.ts` file |
| `--stt-api-key <key>` / `--tts-api-key <key>` | Provider API keys |
| `--mcp-api-key <key>` / `--mcp-timeout <ms>` | MCP auth and timeout |
| `--tts-voice <voice>` / `--tts-speed <speed>` | TTS voice and speed |
| `-v, --verbose` | Show the per-turn latency waterfall table |
| `--save-session <path>` | Save transcript and metrics to JSON |

## Programmatic API

```typescript
import { createSimulator } from '@reaatech/voice-agent-simulator';

const simulator = createSimulator({
  sttProvider: 'deepgram',
  ttsProvider: 'deepgram',
  mcpEndpoint: 'mock',
});

simulator.on('turn', (metrics) => console.log(metrics));
const result = await simulator.run(audioBuffer);
```

Also exported: `Simulator`, `renderLatencyWaterfall`, `readWavFile`,
`writeWavFile`, `captureMicrophone`, `playAudio`, and the
`SimulatorOptions` / `SimulatorResult` / `SimulatorTurnMetrics` types.

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Pipeline, session, latency
- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text providers
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech providers

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
