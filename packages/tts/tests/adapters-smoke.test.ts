/**
 * End-to-end smoke tests for every TTS adapter, driven by recorded audio
 * fixtures (tests/fixtures/*.bin).
 *
 * These replay provider audio bytes through the adapter's real transport
 * (fetch streaming / SDK, mocked) and assert the *normalized* AudioChunk
 * output — including the encoding/sample-rate transforms applied for Twilio
 * (mu-law @ 8 kHz). This is the exact transform-path class that the
 * simulator WAV-reader bug lived in.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioChunk } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadBin = (name: string): Buffer => readFileSync(join(fixturesDir, name));

/** Mock `fetch` returning a streaming body that yields `bytes` in `parts` reads. */
function stubStreamingFetch(bytes: Buffer, parts = 2): void {
  const size = Math.ceil(bytes.length / parts);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(new Uint8Array(bytes.subarray(i, i + size)));
  }
  let idx = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      body: {
        getReader: () => ({
          read: async () =>
            idx < chunks.length
              ? { done: false, value: chunks[idx++] }
              : { done: true, value: undefined },
        }),
      },
    })),
  );
}

async function collect(stream: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

// --- AWS Polly SDK mock ---
let pollyAudioStream: () => AsyncIterable<Uint8Array> = async function* () {};
vi.mock('@aws-sdk/client-polly', () => ({
  OutputFormat: { PCM: 'pcm' },
  Engine: { NEURAL: 'neural', STANDARD: 'standard' },
  SynthesizeSpeechCommand: class {
    constructor(public input: unknown) {}
  },
  PollyClient: class {
    async send() {
      return { AudioStream: pollyAudioStream() };
    }
    destroy() {}
  },
}));

// --- Google Cloud Text-to-Speech SDK mock ---
let googleAudioContent: Buffer = Buffer.alloc(0);
vi.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: class {
    async synthesizeSpeech() {
      return [{ audioContent: googleAudioContent }];
    }
    close() {}
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TTS adapter smoke tests (fixtures)', () => {
  it('deepgram: passes mu-law 8 kHz audio through unchanged', async () => {
    const audio = loadBin('mulaw-8k.bin');
    stubStreamingFetch(audio);
    const { DeepgramTTSProvider } = await import('../src/index.js');
    const provider = new DeepgramTTSProvider();

    const chunks = await collect(
      provider.synthesize('hello', { apiKey: 'test', encoding: 'mulaw', sampleRate: 8000 }),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.encoding === 'mulaw' && c.sampleRate === 8000)).toBe(true);
    expect(Buffer.concat(chunks.map((c) => c.buffer)).equals(audio)).toBe(true);
  });

  it('deepgram: transcodes linear16 16 kHz to mu-law 8 kHz for Twilio', async () => {
    const audio = loadBin('pcm16-16k.bin');
    stubStreamingFetch(audio);
    const { DeepgramTTSProvider } = await import('../src/index.js');
    const provider = new DeepgramTTSProvider();

    const chunks = await collect(
      provider.synthesize('hello', { apiKey: 'test', encoding: 'linear16', sampleRate: 16000 }),
    );

    expect(chunks.every((c) => c.encoding === 'mulaw' && c.sampleRate === 8000)).toBe(true);
    // linear16 -> mu-law halves bytes; 16k -> 8k halves again => /4 total.
    const total = chunks.reduce((n, c) => n + c.buffer.length, 0);
    expect(total).toBe(audio.length / 4);
  });

  it('elevenlabs: passes mu-law 8 kHz audio through unchanged', async () => {
    const audio = loadBin('mulaw-8k.bin');
    stubStreamingFetch(audio);
    const { ElevenLabsTTSProvider } = await import('../src/index.js');
    const provider = new ElevenLabsTTSProvider();

    const chunks = await collect(
      provider.synthesize('hello', { provider: 'elevenlabs', apiKey: 'test' }),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.encoding === 'mulaw' && c.sampleRate === 8000)).toBe(true);
    expect(Buffer.concat(chunks.map((c) => c.buffer)).equals(audio)).toBe(true);
  });

  it('cartesia: transcodes linear16 8 kHz to mu-law 8 kHz', async () => {
    const audio = loadBin('pcm16-8k.bin');
    stubStreamingFetch(audio);
    const { CartesiaTTSProvider } = await import('../src/index.js');
    const provider = new CartesiaTTSProvider();

    const chunks = await collect(
      provider.synthesize('hello', { provider: 'cartesia', apiKey: 'test' }),
    );

    expect(chunks.every((c) => c.encoding === 'mulaw' && c.sampleRate === 8000)).toBe(true);
    const total = chunks.reduce((n, c) => n + c.buffer.length, 0);
    expect(total).toBe(audio.length / 2); // linear16 -> mu-law, already 8 kHz
  });

  it('aws-polly: streams PCM chunks from the SDK AudioStream', async () => {
    const audio = loadBin('pcm16-8k.bin');
    pollyAudioStream = async function* () {
      yield new Uint8Array(audio.subarray(0, 320));
      yield new Uint8Array(audio.subarray(320));
    };
    const { AWSPollyProvider } = await import('../src/index.js');
    const provider = new AWSPollyProvider();
    await provider.connect({ region: 'us-east-1', apiKey: 'test' });

    const chunks = await collect(
      provider.synthesize('hello', { region: 'us-east-1', apiKey: 'test', sampleRate: 8000 }),
    );

    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.encoding === 'pcm' && c.sampleRate === 8000)).toBe(true);
    expect(Buffer.concat(chunks.map((c) => c.buffer)).equals(audio)).toBe(true);
  });

  it('google-cloud-tts: chunks audioContent and transcodes to mu-law 8 kHz', async () => {
    googleAudioContent = loadBin('pcm16-8k.bin');
    const { GoogleCloudTTSProvider } = await import('../src/index.js');
    const provider = new GoogleCloudTTSProvider();

    const chunks = await collect(
      provider.synthesize('hello', {
        projectId: 'demo',
        apiKey: 'test',
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 8000,
      }),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.encoding === 'mulaw' && c.sampleRate === 8000)).toBe(true);
    const total = chunks.reduce((n, c) => n + c.buffer.length, 0);
    expect(total).toBe(googleAudioContent.length / 2);
  });
});
