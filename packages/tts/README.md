# @reaatech/voice-agent-tts

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-tts)](https://www.npmjs.com/package/@reaatech/voice-agent-tts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Provider-agnostic text-to-speech interface with three adapter implementations: Deepgram Aura, AWS Polly, and Google Cloud Text-to-Speech. Streaming audio output via `AsyncIterable<AudioChunk>`, cancelable synthesis, and Twilio-ready audio formatting.

## Installation

```bash
npm install @reaatech/voice-agent-tts
pnpm add @reaatech/voice-agent-tts
```

## Feature Overview

- **Unified TTS interface** — `TTSProvider` with `synthesize()` returning `AsyncIterable<AudioChunk>`
- **Deepgram Aura adapter** — Low-latency HTTP/2 streaming with voice selection and mulaw encoding
- **AWS Polly adapter** — Neural engine with SSML support, multiple voice IDs, sample rate configuration
- **Google Cloud TTS adapter** — 220+ voices, speaking rate, pitch, volume control, and SSML gender
- **Cancelable synthesis** — `cancel()` stops in-progress TTS immediately (barge-in support)
- **Twilio audio formatting** — Automatic mulaw 8kHz conversion via `formatAudioForTwilio()`
- **Silence generation** — `createSilenceChunk()` for injecting pauses between utterances
- **Text chunking** — `chunkTextForStreaming()` to split long responses for streaming TTS
- **Provider factory** — `createTTSProvider()` for runtime provider selection

## Quick Start

```typescript
import { DeepgramTTSProvider } from '@reaatech/voice-agent-tts';

const tts = new DeepgramTTSProvider();

for await (const chunk of tts.synthesize('Hello, how can I help you today?', {
  provider: 'deepgram',
  apiKey: process.env.DEEPGRAM_API_KEY,
  voice: 'asteria',
  model: 'aura',
  encoding: 'mulaw',
  sampleRate: 8000,
})) {
  // Send chunk.buffer to Twilio Media Stream
  twilioHandler.sendAudio(chunk);
}
```

## API Reference

### TTSProvider Interface

```typescript
interface TTSProvider {
  readonly name: string;
  synthesize(text: string, config: DeepgramTTSConfig | AWSPollyConfig | GoogleCloudTTSConfig): AsyncIterable<AudioChunk>;
  readonly supportsStreaming: boolean;
  readonly firstByteLatencyMs: number | null;
  cancel(): void;
  connect?(config: unknown): Promise<void>;
}
```

### TTSProviderInterface (Static Utilities)

```typescript
class TTSProviderInterface {
  static formatAudioForTwilio(chunk: AudioChunk): AudioChunk;
  static createSilenceChunk(durationMs: number, sampleRate?: number): AudioChunk;
  static chunkTextForStreaming(text: string, maxChunkSize?: number): string[];
}
```

| Method | Description |
|--------|-------------|
| `formatAudioForTwilio` | Converts any audio chunk to mulaw 8kHz for Twilio Media Streams |
| `createSilenceChunk` | Creates a mulaw silence buffer of specified duration (default 8kHz) |
| `chunkTextForStreaming` | Splits long text at sentence boundaries for sentence-by-sentence TTS |

### DeepgramTTSProvider

```typescript
class DeepgramTTSProvider implements TTSProvider {
  readonly name = 'deepgram';
  readonly supportsStreaming = true;
  constructor(options?: DeepgramTTSOptions);
  getLastFirstByteLatency(): number | null;
}

interface DeepgramTTSOptions {
  apiUrl?: string;   // default: 'api.deepgram.com'
  version?: string;  // default: 'v1'
}

interface DeepgramTTSConfig extends TTSConfig {
  model?: 'aura';
  voice?: string;        // e.g., 'asteria', 'luna', 'stella', 'arcas'
  encoding?: 'mulaw' | 'linear16' | 'pcm';
  sampleRate?: number;   // 8000, 16000, 24000, 48000
  container?: 'none' | 'wav';
}
```

### AWSPollyProvider

```typescript
class AWSPollyProvider extends EventEmitter implements TTSProvider {
  readonly name = 'aws-polly';
  readonly supportsStreaming = true;
  constructor(options?: AWSPollyOptions);
  connect(config: AWSPollyConfig): Promise<void>;
  onError(cb: (error: Error) => void): void;
  close(): Promise<void>;
  isConnected(): boolean;
}

interface AWSPollyOptions {
  region?: string;          // default: 'us-east-1'
  defaultVoiceId?: string;  // default: 'Joanna'
  defaultEngine?: Engine;   // default: NEURAL
}

interface AWSPollyConfig extends TTSConfig {
  region: string;
  voiceId?: string;          // Joanna, Matthew, Salli, etc.
  engine?: 'standard' | 'neural';
  languageCode?: string;
  sampleRate?: number;       // 8000, 16000, 22050
  textType?: 'text' | 'ssml';
}
```

### GoogleCloudTTSProvider

```typescript
class GoogleCloudTTSProvider implements TTSProvider {
  readonly name = 'google-cloud-tts';
  readonly supportsStreaming = true;
  constructor(options?: GoogleCloudTTSOptions);
  getLastFirstByteLatency(): number | null;
}

interface GoogleCloudTTSOptions {
  projectId?: string;
  keyFilename?: string;
}

interface GoogleCloudTTSConfig extends TTSConfig {
  projectId: string;
  voiceName?: string;              // e.g., 'en-US-Standard-A'
  languageCode?: string;           // e.g., 'en-US'
  ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  audioEncoding?: 'MP3' | 'LINEAR16' | 'OGG_OPUS' | 'MULAW' | 'ALAW';
  sampleRateHertz?: number;
  speakingRate?: number;           // 0.25–4.0
  pitch?: number;                  // -20.0–20.0
  volumeGainDb?: number;           // -96.0–16.0
}
```

### Provider Factory

```typescript
import { createTTSProvider } from '@reaatech/voice-agent-tts';

const tts = createTTSProvider({
  provider: 'deepgram',             // 'deepgram' | 'aws-polly' | 'google-cloud-tts'
  config: { provider: 'deepgram', apiKey: '...' },
});
```

## Usage Patterns

### Barge-In (Cancel In-Progress TTS)

```typescript
// Start TTS
const ttsStream = tts.synthesize(text, config);

// User interrupts — cancel immediately
tts.cancel();
// The synthesize() generator will exit cleanly
```

### Sentence-Level Streaming for Low Latency

```typescript
import { TTSProviderInterface } from '@reaatech/voice-agent-tts';

const sentences = TTSProviderInterface.chunkTextForStreaming(longText, 200);

for (const sentence of sentences) {
  for await (const chunk of tts.synthesize(sentence, config)) {
    handler.sendAudio(chunk);
  }
}
```

### Silence Between Utterances

```typescript
import { TTSProviderInterface } from '@reaatech/voice-agent-tts';

// 500ms silence gap
const silence = TTSProviderInterface.createSilenceChunk(500);
handler.sendAudio(silence);
```

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Core types, pipeline, config
- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text providers
- [@reaatech/voice-agent-telephony](https://www.npmjs.com/package/@reaatech/voice-agent-telephony) — Twilio Media Streams handler

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
