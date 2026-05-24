# @reaatech/create-voice-agent

[![npm version](https://img.shields.io/npm/v/@reaatech/create-voice-agent)](https://www.npmjs.com/package/@reaatech/create-voice-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions.

Scaffolding CLI that bootstraps a complete [voice-agent-kit](https://github.com/reaatech/voice-agent-kit)
project — pipeline config, STT/TTS providers, telephony or WebRTC transport, an
MCP client, and a ready-to-run server.

## Usage

```bash
npm create @reaatech/voice-agent@latest my-agent
# or
npx @reaatech/create-voice-agent my-agent
# or
pnpm create @reaatech/voice-agent my-agent
```

Run with no project name for the interactive prompts, or pass flags to skip them.

## Options

| Option | Description |
|--------|-------------|
| `[project-name]` | Directory to create the project in |
| `--quick` | Non-interactive — use defaults |
| `--stt <provider>` | STT provider (e.g. `deepgram`, `openai`, `assemblyai`) |
| `--tts <provider>` | TTS provider (e.g. `deepgram`, `elevenlabs`, `cartesia`) |
| `--telephony <provider>` | Telephony provider: `twilio`, `telnyx`, `none` |
| `--transport <type>` | Transport: `twilio` or `webrtc` |
| `--mcp <endpoint>` | MCP endpoint URL |
| `--skip-install` | Don't install dependencies after scaffolding |

## Example

```bash
npx @reaatech/create-voice-agent my-agent \
  --quick \
  --stt deepgram \
  --tts elevenlabs \
  --telephony twilio \
  --transport twilio
```

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Pipeline, session, latency
- [@reaatech/voice-agent-simulator](https://www.npmjs.com/package/@reaatech/voice-agent-simulator) — Local dev runner

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
