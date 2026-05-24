# @reaatech/voice-agent-webrtc

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-webrtc)](https://www.npmjs.com/package/@reaatech/voice-agent-webrtc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Browser transport for voice AI agents over a WebSocket connection, with Opus
encode/decode and PCM resampling helpers. Use this as the server-side counterpart
to a browser client that streams microphone audio in, and plays agent audio out.

## Installation

```bash
npm install @reaatech/voice-agent-webrtc
pnpm add @reaatech/voice-agent-webrtc
```

### Opus codec (optional)

Opus encode/decode requires a native codec binding. Install **one** of the
following only if you need Opus (raw PCM transport works without it):

```bash
pnpm add @discordjs/opus   # preferred — prebuilt native addon
# or
pnpm add prism-media
```

Both are **optional** and loaded lazily at runtime. `isOpusAvailable()` returns
`false` when neither is installed, and `encodeOpus` / `decodeOpus` throw a clear
error pointing you here.

## Feature Overview

- **WebSocket transport** — `WebRTCTransport` manages a browser audio session over `ws`
- **Barge-in detection** — energy + confidence thresholds interrupt agent playback when the caller speaks
- **Opus codec** — `encodeOpus` / `decodeOpus` with lazy-loaded native bindings
- **PCM utilities** — `resample`, `convertSampleFormat`, `interleaveToMono`, `monoToInterleave`, `changeVolume`

## Quick Start

```typescript
import { WebRTCTransport } from '@reaatech/voice-agent-webrtc';

const transport = new WebRTCTransport(socket, {
  outputSampleRate: 48000,
  outputChannels: 1,
  bargeInEnabled: true,
  minSpeechDuration: 200,
  confidenceThreshold: 0.6,
  silenceThreshold: 500,
  frameDurationMs: 20,
});
```

## API Reference

### WebRTCTransport

```typescript
class WebRTCTransport {
  constructor(socket: WebSocket, config: WebRTCTransportConfig);
}
```

### Codec & PCM helpers

```typescript
import {
  isOpusAvailable,
  encodeOpus,
  decodeOpus,
  resample,
  convertSampleFormat,
  interleaveToMono,
  monoToInterleave,
  changeVolume,
} from '@reaatech/voice-agent-webrtc';
```

| Function | Description |
|----------|-------------|
| `isOpusAvailable()` | `true` if a native Opus binding is installed |
| `encodeOpus(pcm, sampleRate, channels)` | PCM Int16 → Opus packet |
| `decodeOpus(opus, sampleRate, channels)` | Opus packet → PCM Int16 |
| `resample(pcm, fromRate, toRate)` | Linear PCM resampling |
| `convertSampleFormat(...)` | Convert between PCM sample formats |
| `interleaveToMono` / `monoToInterleave` | Channel layout conversion |
| `changeVolume(pcm, gain)` | Apply a gain multiplier |

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Pipeline, session, latency
- [@reaatech/voice-agent-telephony](https://www.npmjs.com/package/@reaatech/voice-agent-telephony) — Twilio/Telnyx/SignalWire/Vonage transport
- [@reaatech/voice-agent-simulator](https://www.npmjs.com/package/@reaatech/voice-agent-simulator) — Local dev runner

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
