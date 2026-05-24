# @reaatech/voice-agent-stt

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-stt)](https://www.npmjs.com/package/@reaatech/voice-agent-stt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/test.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Provider-agnostic speech-to-text interface with seven adapter implementations: Deepgram, AWS Transcribe, Google Cloud Speech-to-Text, OpenAI Realtime, OpenAI Whisper, AssemblyAI, and Groq Whisper. Built-in audio format conversion between mulaw and linear16, plus sample rate resampling.

## Installation

```bash
npm install @reaatech/voice-agent-stt
pnpm add @reaatech/voice-agent-stt
```

### Provider SDKs (install only what you use)

The cloud adapters load their provider SDKs lazily and declare them as **optional peer dependencies**, so you only install the SDK for the provider you actually use. Deepgram needs no extra SDK.

```bash
# AWS Transcribe
npm install @aws-sdk/client-transcribe-streaming @aws-sdk/credential-provider-ini

# Google Cloud Speech-to-Text
npm install @google-cloud/speech
```

## Feature Overview

- **Unified STT interface** — `STTProvider` with `connect`, `streamAudio`, `onUtterance`, `onEndOfSpeech`, `onError`
- **Deepgram adapter** — WebSocket streaming with nova-2, interim results, VAD, smart formatting
- **AWS Transcribe adapter** — Streaming recognition with speaker labels, vocabulary, channel identification
- **Google Cloud STT adapter** — Bidirectional streaming with enhanced models, punctuation, word time offsets
- **OpenAI Realtime adapter** — WebSocket streaming with GPT-4o realtime transcription
- **OpenAI Whisper adapter** — HTTP batch transcription for short utterances
- **AssemblyAI adapter** — WebSocket streaming with high accuracy
- **Groq Whisper adapter** — Ultra-fast Whisper inference via HTTP
- **Audio format conversion** — Mulaw ↔ linear16 and sample rate resampling in the base interface
- **Auto-reconnect** — Configurable retry with exponential backoff on all adapters
- **Audio queue** — Buffers audio chunks during reconnection to prevent data loss
- **Provider factory** — `createSTTProvider()` for runtime provider selection

## Quick Start

```typescript
import { DeepgramSTTProvider } from '@reaatech/voice-agent-stt';

const stt = new DeepgramSTTProvider();

await stt.connect({
  provider: 'deepgram',
  apiKey: process.env.DEEPGRAM_API_KEY,
  model: 'nova-2',
  language: 'en',
  sampleRate: 8000,
  encoding: 'mulaw',
  smartFormat: true,
  interimResults: true,
  endpointing: 300,
});

stt.onUtterance((utterance) => {
  if (utterance.isFinal) {
    console.log('Final transcript:', utterance.transcript);
  }
});

stt.onEndOfSpeech(() => {
  console.log('User stopped speaking');
});

stt.streamAudio(audioChunk);
```

## API Reference

### STTProvider Interface

```typescript
interface STTProvider {
  readonly name: string;
  connect(config: DeepgramConfig | AWSTranscribeConfig | GoogleCloudSTTConfig): Promise<void>;
  streamAudio(chunk: AudioChunk): void;
  onUtterance(cb: (utterance: Utterance) => void): void;
  onEndOfSpeech(cb: () => void): void;
  onError(cb: (error: Error) => void): void;
  close(): Promise<void>;
  isConnected(): boolean;
}
```

### STTProviderInterface (Static Utilities)

```typescript
class STTProviderInterface {
  static validateAudioChunk(chunk: AudioChunk): boolean;
  static convertAudioFormat(chunk: AudioChunk, targetSampleRate: number, targetEncoding: string): AudioChunk;
  static mulawToLinear16(mulawBuffer: Buffer): Buffer;
}
```

### DeepgramSTTProvider

```typescript
class DeepgramSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'deepgram';
  constructor(options?: DeepgramSTTOptions);
}

interface DeepgramSTTOptions {
  apiUrl?: string;           // default: 'api.deepgram.com'
  version?: string;          // default: 'v1'
  reconnectAttempts?: number; // default: 3
  reconnectInterval?: number; // default: 1000ms
}

interface DeepgramConfig extends STTConfig {
  model?: 'nova-2' | 'nova' | 'enhanced' | 'base';
  language?: string;
  smartFormat?: boolean;
  punctuation?: boolean;
  profanityFilter?: boolean;
  interimResults?: boolean;
  vadEvents?: boolean;
  endpointing?: number | false;
  silenceThreshold?: number;
}
```

### AWSTranscribeProvider

```typescript
class AWSTranscribeProvider extends EventEmitter implements STTProvider {
  readonly name = 'aws-transcribe';
  constructor(options?: AWSTranscribeOptions);
}

interface AWSTranscribeConfig extends STTConfig {
  region: string;
  languageCode?: string;               // default: 'en-US'
  vocabularyName?: string;
  showSpeakerLabels?: boolean;
  maxSpeakerLabels?: number;
  enableChannelIdentification?: boolean;
  numberOfChannels?: number;
}
```

### GoogleCloudSTTProvider

```typescript
class GoogleCloudSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'google-cloud-stt';
  constructor(options?: GoogleCloudSTTOptions);
}

interface GoogleCloudSTTConfig extends STTConfig {
  projectId: string;
  languageCode?: string;               // default: 'en-US'
  alternativeLanguageCodes?: string[];
  model?: 'latest_long' | 'latest_short' | 'phone_call' | 'video';
  useEnhanced?: boolean;
  profanityFilter?: boolean;
  enableAutomaticPunctuation?: boolean;
  enableWordTimeOffsets?: boolean;
  maxAlternatives?: number;
  singleUtterance?: boolean;
  interimResults?: boolean;
}
```

### OpenAIRealtimeProvider

```typescript
class OpenAIRealtimeProvider extends EventEmitter implements STTProvider {
  readonly name = 'openai-realtime';
  constructor(options?: OpenAIRealtimeOptions);
}

interface OpenAIRealtimeConfig extends STTConfig {
  model?: 'gpt-4o-realtime-preview';
  language?: string;
  voice?: 'alloy' | 'echo' | 'shimmer';
  temperature?: number;
  maxTokens?: number;
}
```

WebSocket streaming adapter for GPT-4o realtime transcription. Supports interim results and native 24kHz audio.

### OpenAIWhisperProvider

```typescript
class OpenAIWhisperProvider extends EventEmitter implements STTProvider {
  readonly name = 'openai-whisper';
  constructor(options?: OpenAIWhisperOptions);
}

interface OpenAIWhisperConfig extends STTConfig {
  model?: 'whisper-1';
  language?: string;
  prompt?: string;
  responseFormat?: 'json' | 'text' | 'srt';
}
```

HTTP batch adapter for OpenAI Whisper. Best suited for short utterances. No streaming support.

### AssemblyAIProvider

```typescript
class AssemblyAIProvider extends EventEmitter implements STTProvider {
  readonly name = 'assemblyai';
  constructor(options?: AssemblyAIOptions);
}

interface AssemblyAIConfig extends STTConfig {
  languageCode?: string;
  endUtteranceSilenceThreshold?: number;
  wordBoost?: string[];
  punctuate?: boolean;
  formatText?: boolean;
}
```

WebSocket streaming adapter with high accuracy and end-utterance silence detection.

### GroqWhisperProvider

```typescript
class GroqWhisperProvider extends EventEmitter implements STTProvider {
  readonly name = 'groq-whisper';
  constructor(options?: GroqWhisperOptions);
}

interface GroqWhisperConfig extends STTConfig {
  model?: 'whisper-large-v3' | 'whisper-large-v3-turbo';
  language?: string;
  prompt?: string;
  responseFormat?: 'json' | 'verbose_json' | 'text';
}
```

Ultra-fast Whisper inference via Groq's LPU hardware. HTTP batch mode with sub-100ms P50 latency.

### Provider Factory

```typescript
import { createSTTProvider } from '@reaatech/voice-agent-stt';

const stt = createSTTProvider({
  provider: 'deepgram',            // 'deepgram' | 'aws-transcribe' | 'google-cloud-stt' | 'openai-realtime' | 'openai-whisper' | 'assemblyai' | 'groq-whisper' | 'mock'
  config: { provider: 'deepgram', apiKey: '...' },
});
```

## Usage Patterns

### Audio Format Conversion

```typescript
import { STTProviderInterface } from '@reaatech/voice-agent-stt';

// Convert Twilio mulaw 8kHz to Deepgram linear16 16kHz
const converted = STTProviderInterface.convertAudioFormat(
  twilioChunk,
  16000,     // target sample rate
  'linear16' // target encoding
);
```

### Reconnection Handling

All adapters attempt automatic reconnection on connection loss. Configure retry behavior:

```typescript
const stt = new DeepgramSTTProvider({
  reconnectAttempts: 5,
  reconnectInterval: 2000,
});

// Audio chunks are queued during reconnection and flushed on reconnect
```

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Core types, pipeline, config
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech providers
- [@reaatech/voice-agent-telephony](https://www.npmjs.com/package/@reaatech/voice-agent-telephony) — Twilio Media Streams handler

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
