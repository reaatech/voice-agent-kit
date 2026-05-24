/**
 * End-to-end smoke tests for every STT adapter, driven by recorded provider
 * response fixtures (tests/fixtures/*.json).
 *
 * Unlike the per-adapter unit tests, these replay a realistic provider payload
 * through the adapter's real transport (WebSocket / fetch / SDK, all mocked)
 * and assert the *normalized* `Utterance` the rest of the pipeline consumes.
 * This guards the parse/transform code paths against silent regressions.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Utterance } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadRaw = (name: string): Buffer => readFileSync(join(fixturesDir, name));
const loadJson = (name: string): unknown => JSON.parse(loadRaw(name).toString());

// --- WebSocket transport mock (deepgram, assemblyai, openai-realtime, S2S) ---
let lastWs: MockWebSocket | null = null;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1;
  private handlers = new Map<string, (...args: unknown[]) => void>();

  constructor() {
    lastWs = this;
    setTimeout(() => this.fire('open'), 0);
  }
  on(event: string, handler: (...args: unknown[]) => void): this {
    this.handlers.set(event, handler);
    return this;
  }
  once(event: string, handler: (...args: unknown[]) => void): this {
    return this.on(event, handler);
  }
  send(): void {}
  ping(): void {}
  close(): void {
    this.readyState = 3;
    this.fire('close', 1000);
  }
  removeAllListeners(): void {
    this.handlers.clear();
  }
  private fire(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }
  /** Test helper: deliver a provider message to the adapter. */
  deliver(data: unknown): void {
    this.handlers.get('message')?.(Buffer.from(JSON.stringify(data)));
  }
}

vi.mock('ws', () => ({ default: MockWebSocket }));

// --- AWS Transcribe SDK mock ---
let awsSend: () => Promise<unknown> = async () => ({});
vi.mock('@aws-sdk/client-transcribe-streaming', () => ({
  MediaEncoding: { PCM: 'pcm' },
  StartStreamTranscriptionCommand: class {
    constructor(public input: unknown) {}
  },
  TranscribeStreamingClient: class {
    send() {
      return awsSend();
    }
    destroy() {}
  },
}));

// --- Google Cloud Speech SDK mock ---
let googleStream: GoogleFakeStream | null = null;
class GoogleFakeStream extends EventEmitter {
  write(): boolean {
    return true;
  }
  end(): void {}
  destroy(): void {}
}
vi.mock('@google-cloud/speech', () => ({
  SpeechClient: class {
    streamingRecognize() {
      googleStream = new GoogleFakeStream();
      return googleStream;
    }
    close() {}
  },
}));

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function importAdapters() {
  return await import('../src/index.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  lastWs = null;
  googleStream = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('STT adapter smoke tests (fixtures)', () => {
  it('deepgram: parses a final transcript message', async () => {
    const { DeepgramSTTProvider } = await importAdapters();
    const provider = new DeepgramSTTProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ apiKey: 'test' });
    lastWs?.deliver(loadJson('deepgram-final.json'));

    expect(utterances).toHaveLength(1);
    expect(utterances[0]?.transcript).toBe('what is the weather in tokyo');
    expect(utterances[0]?.isFinal).toBe(true);
    expect(utterances[0]?.confidence).toBeCloseTo(0.98741, 4);
    await provider.close();
  });

  it('assemblyai: parses a FinalTranscript message', async () => {
    const { AssemblyAIProvider } = await importAdapters();
    const provider = new AssemblyAIProvider();
    const utterances: Utterance[] = [];
    let endOfSpeech = false;
    provider.onUtterance((u) => utterances.push(u));
    provider.onEndOfSpeech(() => {
      endOfSpeech = true;
    });

    await provider.connect({ apiKey: 'test' });
    lastWs?.deliver(loadJson('assemblyai-final.json'));

    expect(utterances[0]?.transcript).toBe('book a table for two at seven pm');
    expect(utterances[0]?.isFinal).toBe(true);
    expect(endOfSpeech).toBe(true);
    await provider.close();
  });

  it('openai-realtime: parses a completed input transcription', async () => {
    const { OpenAIRealtimeSTTProvider } = await importAdapters();
    const provider = new OpenAIRealtimeSTTProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ apiKey: 'test' });
    lastWs?.deliver(loadJson('openai-realtime-completed.json'));

    expect(utterances[0]?.transcript).toBe('turn on the living room lights');
    expect(utterances[0]?.isFinal).toBe(true);
    await provider.close();
  });

  it('openai-realtime-s2s: emits transcript from completed input transcription', async () => {
    const { OpenAIRealtimeS2SProvider } = await importAdapters();
    const provider = new OpenAIRealtimeS2SProvider();
    const transcripts: Utterance[] = [];
    provider.onTranscript((u) => transcripts.push(u));

    await provider.connect({ apiKey: 'test' });
    lastWs?.deliver(loadJson('openai-realtime-s2s-completed.json'));

    expect(transcripts[0]?.transcript).toBe('what time do you close today');
    expect(transcripts[0]?.isFinal).toBe(true);
    await provider.close();
  });

  it('gemini-live-s2s: emits transcript from a model turn', async () => {
    const { GeminiLiveS2SProvider } = await importAdapters();
    const provider = new GeminiLiveS2SProvider();
    const transcripts: Utterance[] = [];
    provider.onTranscript((u) => transcripts.push(u));

    await provider.connect({ apiKey: 'test' });
    lastWs?.deliver(loadJson('gemini-modelturn.json'));

    expect(transcripts.at(-1)?.transcript).toBe('Sure, I can help you with that.');
    await provider.close();
  });

  it('openai-whisper: transcribes buffered audio via HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => loadJson('openai-whisper-response.json'),
        text: async () => '',
      })),
    );
    const { OpenAIWhisperSTTProvider } = await importAdapters();
    const provider = new OpenAIWhisperSTTProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ apiKey: 'test' });
    provider.streamAudio({
      buffer: Buffer.alloc(64000, 1),
      sampleRate: 16000,
      encoding: 'linear16',
      channels: 1,
      timestamp: Date.now(),
    });
    await provider.close(); // flushes + transcribes the final buffer

    expect(utterances.at(-1)?.transcript).toBe('remind me to call the dentist tomorrow morning');
  });

  it('groq-whisper: transcribes buffered audio via HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => loadJson('groq-response.json'),
        text: async () => '',
      })),
    );
    const { GroqWhisperSTTProvider } = await importAdapters();
    const provider = new GroqWhisperSTTProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ apiKey: 'test' });
    provider.streamAudio({
      buffer: Buffer.alloc(64000, 1),
      sampleRate: 16000,
      encoding: 'linear16',
      channels: 1,
      timestamp: Date.now(),
    });
    await provider.close();

    expect(utterances.at(-1)?.transcript).toBe('play some jazz music in the kitchen');
  });

  it('aws-transcribe: parses a transcript result event from the stream', async () => {
    const event = loadJson('aws-transcribe-event.json');
    awsSend = async () => ({
      TranscriptResultStream: (async function* () {
        yield event;
      })(),
    });
    const { AWSTranscribeProvider } = await importAdapters();
    const provider = new AWSTranscribeProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ region: 'us-east-1', apiKey: 'test' });
    await tick();

    expect(utterances[0]?.transcript).toBe('transfer fifty dollars to my savings account');
    expect(utterances[0]?.isFinal).toBe(true);
    await provider.close();
  });

  it('google-cloud-stt: parses a streaming recognition response', async () => {
    const { GoogleCloudSTTProvider } = await importAdapters();
    const provider = new GoogleCloudSTTProvider();
    const utterances: Utterance[] = [];
    provider.onUtterance((u) => utterances.push(u));

    await provider.connect({ projectId: 'demo', apiKey: 'test' });
    googleStream?.emit('data', loadJson('google-stt-response.json'));

    expect(utterances[0]?.transcript).toBe('schedule a meeting with the design team on friday');
    expect(utterances[0]?.isFinal).toBe(true);
    await provider.close();
  });
});
