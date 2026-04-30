# @reaatech/voice-agent-telephony

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-telephony)](https://www.npmjs.com/package/@reaatech/voice-agent-telephony)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Twilio Media Streams WebSocket handler for voice AI agents. Handles the complete Twilio bidirectional streaming protocol: start/media/stop/mark/dtmf events, barge-in detection, audio buffering, and base64 encoding/decoding.

## Installation

```bash
npm install @reaatech/voice-agent-telephony
pnpm add @reaatech/voice-agent-telephony
```

## Feature Overview

- **Twilio Media Streams protocol** — Full support for start, media, stop, mark, and DTMF events
- **Barge-in detection** — Configurable interruption during TTS playback based on speech duration and confidence
- **Audio send/clear** — Send TTS audio chunks and clear the output buffer via Twilio `clear` event
- **Mark tracking** — Send and track Twilio `mark` events for audio position synchronization
- **Call lifecycle** — CallSid and StreamSid tracking, connected/disconnected events, graceful close
- **Base64 encode/decode** — Static utility methods for Twilio's base64 audio payload format
- **Typed message interfaces** — Full TypeScript types for all Twilio inbound and outbound messages
- **Reconnection-safe** — Handles already-open WebSocket connections gracefully

## Quick Start

```typescript
import { createTwilioHandler } from '@reaatech/voice-agent-telephony';
import WebSocket from 'ws';

// In your WebSocket server
wss.on('connection', async (ws) => {
  const handler = createTwilioHandler({
    bargeInEnabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  });

  await handler.acceptConnection(ws);

  handler.on('audio:received', (chunk) => {
    // Forward to STT provider
    sttProvider.streamAudio(chunk);
  });

  handler.on('barge-in:detected', () => {
    // Stop TTS, clear audio buffer
    ttsProvider.cancel();
    handler.clearAudio();
  });

  handler.on('call:end', () => {
    handler.close();
  });
});
```

## API Reference

### TwilioMediaStreamHandler

```typescript
class TwilioMediaStreamHandler extends EventEmitter {
  constructor(config?: Partial<TwilioHandlerConfig>);

  // Connection
  acceptConnection(ws: WebSocket): Promise<void>;

  // Audio
  sendAudio(chunk: AudioChunk): void;
  clearAudio(): Promise<void>;

  // Mark tracking
  sendMark(): Promise<string>;

  // TTS state
  setTTSPlaying(playing: boolean): void;
  isTTSActive(): boolean;

  // Session info
  getCallSid(): string | null;
  getStreamSid(): string | null;

  // Barge-in
  isBargeInEnabled(): boolean;
  getBargeInThresholds(): { minSpeechDuration, confidenceThreshold, silenceThreshold };
  onInterimTranscript(transcript: string, confidence: number): void;

  // Cleanup
  close(): Promise<void>;

  // Static utilities
  static encodeForTwilio(buffer: Buffer): string;
  static decodeFromTwilio(base64: string): Buffer;
}
```

### TwilioHandlerConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `bargeInEnabled` | `boolean` | `false` | Enable barge-in detection during TTS |
| `minSpeechDuration` | `number` | `300` | Minimum speech duration in ms to trigger barge-in |
| `confidenceThreshold` | `number` | `0.7` | Minimum STT confidence (0–1) to count as speech |
| `silenceThreshold` | `number` | `0.3` | Reserved for future silence-based interruption |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | — | WebSocket connection opened |
| `disconnected` | — | WebSocket connection closed |
| `call:start` | `{ callSid, streamSid, codec, customParameters }` | Inbound call started |
| `call:end` | `{ callSid }` | Inbound call ended |
| `audio:received` | `AudioChunk` | Base64-decoded audio buffer from caller |
| `barge-in:detected` | `BargeInEvent` | User interrupted during TTS playback |
| `mark:played` | `{ streamSid }` | Twilio confirmed mark was played |
| `dtmf:received` | `{ digit, streamSid }` | DTMF digit pressed by caller |
| `error` | `Error` | WebSocket or protocol error |

### Twilio Message Types

```typescript
type TwilioMessage =
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioStopMessage
  | TwilioMarkMessage
  | TwilioDTMFMessage;

interface TwilioOutboundMessage {
  event: 'media' | 'clear' | 'mark' | 'start';
  streamSid?: string;
  media?: { payload: string };
  mark?: { name: string };
}
```

## Usage Patterns

### Sending TTS Audio to Twilio

```typescript
for await (const chunk of ttsProvider.synthesize(text, config)) {
  handler.sendAudio(chunk);
}

// Signal TTS is done
handler.setTTSPlaying(false);
```

### Barge-In Integration

```typescript
// Configure barge-in on handler creation
const handler = createTwilioHandler({
  bargeInEnabled: true,
  minSpeechDuration: 300,
  confidenceThreshold: 0.7,
});

// Feed interim transcripts from STT into barge-in detector
sttProvider.onUtterance((utterance) => {
  if (!utterance.isFinal) {
    handler.onInterimTranscript(utterance.transcript, utterance.confidence);
  }
});

// Handle barge-in
handler.on('barge-in:detected', (event) => {
  ttsProvider.cancel();       // Stop current TTS
  handler.clearAudio();       // Clear Twilio audio buffer
  handler.setTTSPlaying(false);
});
```

### Mark Events for Audio Position

```typescript
handler.setTTSPlaying(true);

// Insert a mark before sending audio
const markName = await handler.sendMark();

handler.on('mark:played', ({ streamSid }) => {
  console.log(`Mark ${markName} was played to stream ${streamSid}`);
});

// Send audio...
handler.sendAudio(chunk);
```

### Full Call Lifecycle

```typescript
handler.on('call:start', ({ callSid, streamSid, customParameters }) => {
  console.log(`Call ${callSid} started`);
  // Create session, connect providers, start pipeline
});

handler.on('call:end', ({ callSid }) => {
  console.log(`Call ${callSid} ended`);
  // Clean up session, disconnect providers
});
```

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Core types, pipeline, config
- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text providers
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech providers

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
