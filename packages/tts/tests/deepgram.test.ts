import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepgramTTSProvider, DeepgramTTSProvider } from '../src/adapters/deepgram.js';
import type { DeepgramTTSConfig } from '../src/interface.js';

function createMockResponse(body: ReadableStream | null, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body,
    headers: new Map(),
  });
}

describe('DeepgramTTSProvider', () => {
  let provider: DeepgramTTSProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new DeepgramTTSProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      const p = new DeepgramTTSProvider();
      expect(p.name).toBe('deepgram');
      expect(p.supportsStreaming).toBe(true);
      expect(p.firstByteLatencyMs).toBeNull();
    });

    it('should accept custom options', () => {
      const p = new DeepgramTTSProvider({ apiUrl: 'custom.api.com', version: 'v2' });
      expect(p.name).toBe('deepgram');
    });
  });

  describe('synthesize', () => {
    function setupMockStream(data: Uint8Array) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream));
      vi.stubGlobal('fetch', fetchSpy);
    }

    it('should synthesize with valid config and return audio chunks', async () => {
      const audioData = new Uint8Array([0x7f, 0x80, 0xff]);
      setupMockStream(audioData);

      const config: DeepgramTTSConfig = {
        apiKey: 'test-api-key',
        voice: 'asteria',
        model: 'aura',
        encoding: 'mulaw',
        sampleRate: 8000,
        container: 'none',
      };

      const chunks: Array<{ buffer: Buffer; sampleRate: number; encoding: string }> = [];
      for await (const chunk of provider.synthesize('Hello world', config)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].encoding).toBe('mulaw');
      expect(chunks[0].sampleRate).toBe(8000);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain('api.deepgram.com');
      expect(callUrl).toContain('/v1/speak');
      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBe('Token test-api-key');
    });

    it('should fall back to env var for API key', async () => {
      vi.stubEnv('DEEPGRAM_API_KEY', 'env-api-key');
      const audioData = new Uint8Array([0x01, 0x02]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(audioData);
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream));
      vi.stubGlobal('fetch', fetchSpy);

      const config: DeepgramTTSConfig = {
        voice: 'asteria',
        model: 'aura',
      };

      const chunks: Array<unknown> = [];
      for await (const chunk of provider.synthesize('Hello', config)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
    });

    it('should throw on missing API key', async () => {
      vi.stubEnv('DEEPGRAM_API_KEY', '');
      const config: DeepgramTTSConfig = {
        voice: 'asteria',
      };

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', config)) {
          // noop
        }
      }).rejects.toThrow('Deepgram API key is required');
    });

    it('should throw on non-ok HTTP response', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x00]));
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream, 401));
      vi.stubGlobal('fetch', fetchSpy);

      const config: DeepgramTTSConfig = {
        apiKey: 'bad-key',
      };

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', config)) {
          // noop
        }
      }).rejects.toThrow('Deepgram TTS error');
    });

    it('should handle missing response body', async () => {
      fetchSpy = vi.fn().mockResolvedValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: null,
          headers: new Map(),
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const config: DeepgramTTSConfig = {
        apiKey: 'test',
      };

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', config)) {
          // noop
        }
      }).rejects.toThrow('No response body');
    });
  });

  describe('cancel', () => {
    it('should abort in-progress synthesis', async () => {
      const fetchSpy = vi.fn().mockImplementation((_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (options as RequestInit)?.signal as AbortSignal | undefined;
          if (signal) {
            if (signal.aborted) {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const config: DeepgramTTSConfig = {
        apiKey: 'test-api-key',
      };

      const gen = provider.synthesize('Hello', config);
      const nextPromise = gen.next();
      provider.cancel();
      const result = await nextPromise;
      expect(result.done).toBe(true);
    });
  });

  describe('first-byte latency', () => {
    it('should track first-byte latency via getLastFirstByteLatency', async () => {
      const audioData = new Uint8Array([0x01, 0x02]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(audioData);
          controller.close();
        },
      });
      const fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream));
      vi.stubGlobal('fetch', fetchSpy);

      const p = new DeepgramTTSProvider();
      const config: DeepgramTTSConfig = { apiKey: 'test' };

      for await (const _ of p.synthesize('test', config)) {
        // consume
      }

      const latency = p.getLastFirstByteLatency();
      expect(latency).not.toBeNull();
      expect(latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('default options', () => {
    it('should use default Deepgram config values', () => {
      const p = new DeepgramTTSProvider();
      expect(p.name).toBe('deepgram');
      expect(p.supportsStreaming).toBe(true);
    });
  });

  it('createDeepgramTTSProvider should instantiate provider', () => {
    const p = createDeepgramTTSProvider({ apiUrl: 'custom.api.com' });
    expect(p).toBeInstanceOf(DeepgramTTSProvider);
    expect(p.name).toBe('deepgram');
  });
});
