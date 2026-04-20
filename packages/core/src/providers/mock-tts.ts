import type { TTSProvider } from '../pipeline/index.js';
import type { AudioChunk } from '../types/index.js';

export interface MockTTSOptions {
  delay?: number;
  firstByteDelay?: number;
  chunkSize?: number;
  sampleRate?: number;
  encoding?: 'mulaw' | 'linear16' | 'pcm';
}

export class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;

  private options: MockTTSOptions;
  private lastBenchmarkTime?: number;
  private cancelled = false;

  constructor(options: MockTTSOptions = {}) {
    this.options = {
      delay: 50,
      firstByteDelay: 100,
      chunkSize: 320, // 20ms at 16kHz, 16-bit
      sampleRate: 8000,
      encoding: 'mulaw',
      ...options,
    };
  }

  async *synthesize(text: string): AsyncIterable<AudioChunk> {
    const startTime = performance.now();
    this.cancelled = false;

    await new Promise(resolve => setTimeout(resolve, this.options.firstByteDelay));

    this.lastBenchmarkTime = performance.now() - startTime;

    const chunkCount = Math.max(1, Math.ceil(text.length / 10));

    for (let i = 0; i < chunkCount; i++) {
      if (this.cancelled) {return;}

      const buffer = Buffer.alloc(this.options.chunkSize ?? 320, 0x7f);

      const chunk: AudioChunk = {
        buffer,
        sampleRate: this.options.sampleRate ?? 8000,
        encoding: this.options.encoding ?? 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      yield chunk;

      if (i < chunkCount - 1) {
        await new Promise(resolve => setTimeout(resolve, this.options.delay));
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  getLastFirstByteLatency(): number | null {
    return this.lastBenchmarkTime ?? null;
  }

  resetBenchmark(): void {
    this.lastBenchmarkTime = undefined;
  }
}

export function createMockTTSProvider(options?: MockTTSOptions): MockTTSProvider {
  return new MockTTSProvider(options);
}
