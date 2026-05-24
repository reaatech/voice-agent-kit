import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartesiaTTSProvider, createCartesiaTTSProvider } from '../src/adapters/cartesia.js';
import type { CartesiaConfig } from '../src/interface.js';

function createMockResponse(body: ReadableStream | null, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body,
    headers: new Map(),
    text: () => Promise.resolve(status === 200 ? '' : 'error body'),
  });
}

describe('CartesiaTTSProvider', () => {
  let provider: CartesiaTTSProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new CartesiaTTSProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      const p = new CartesiaTTSProvider();
      expect(p.name).toBe('cartesia');
      expect(p.supportsStreaming).toBe(true);
      expect(p.firstByteLatencyMs).toBeNull();
    });

    it('should accept custom apiUrl', () => {
      const p = new CartesiaTTSProvider({ apiUrl: 'custom.cartesia.ai' });
      expect(p.name).toBe('cartesia');
    });
  });

  describe('connect', () => {
    it('should validate API key and set connected', async () => {
      await provider.connect({
        provider: 'cartesia',
        apiKey: 'valid-key',
      });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw on missing API key', async () => {
      await expect(
        provider.connect({ provider: 'cartesia' }),
      ).rejects.toThrow('Cartesia API key is required');
    });

    it('should use env var for API key', async () => {
      vi.stubEnv('CARTESIA_API_KEY', 'env-key');
      await provider.connect({ provider: 'cartesia' });
      expect(provider.isConnected()).toBe(true);
    });
  });

  describe('synthesize', () => {
    function setupMockStream(data: Uint8Array) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream));
      vi.stubGlobal('fetch', fetchSpy);
    }

    it('should send correct request to Cartesia API', async () => {
      const audioData = new Uint8Array([0x7f, 0x80]);
      setupMockStream(audioData);

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test-key',
      });

      const config: CartesiaConfig = {
        provider: 'cartesia',
        voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
        modelId: 'sonic-english',
        outputFormat: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sampleRate: 8000,
        },
      };

      const chunks: Array<unknown> = [];
      for await (const chunk of provider.synthesize('Hello world', config)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toBe('https://api.cartesia.ai/tts/bytes');

      const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('test-key');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(callInit.body as string);
      expect(body.transcript).toBe('Hello world');
      expect(body.modelId).toBe('sonic-english');
    });

    it('should include Cartesia-Version: 2024-06-10 header', async () => {
      setupMockStream(new Uint8Array([0x01]));

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test-key',
      });

      for await (const _ of provider.synthesize('Hello', {
        provider: 'cartesia',
      })) {
        // consume
      }

      const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['Cartesia-Version']).toBe('2024-06-10');
    });

    it('should handle pcm_mulaw encoding', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x7f, 0x80]));
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream));
      vi.stubGlobal('fetch', fetchSpy);

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test',
      });

      for await (const chunk of provider.synthesize('test', {
        provider: 'cartesia',
        outputFormat: { container: 'raw', encoding: 'pcm_mulaw', sampleRate: 8000 },
      })) {
        expect(chunk.encoding).toBe('mulaw');
      }
    });

    it('should handle pcm_f32le encoding in request body', async () => {
      setupMockStream(new Uint8Array([0x00, 0x00, 0x00, 0x00]));

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test',
      });

      for await (const _ of provider.synthesize('test', {
        provider: 'cartesia',
        outputFormat: { container: 'raw', encoding: 'pcm_f32le', sampleRate: 16000 },
      })) {
        // consume
      }

      const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.outputFormat.encoding).toBe('pcm_f32le');
      expect(body.outputFormat.sampleRate).toBe(16000);
    });

    it('should throw on non-ok response', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x00]));
          controller.close();
        },
      });
      fetchSpy = vi.fn().mockResolvedValue(createMockResponse(stream, 401));
      vi.stubGlobal('fetch', fetchSpy);

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'bad-key',
      });

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'cartesia',
        })) {
          // noop
        }
      }).rejects.toThrow('Cartesia TTS error');
    });

    it('should throw when no API key available', async () => {
      vi.stubEnv('CARTESIA_API_KEY', '');
      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'cartesia',
        })) {
          // noop
        }
      }).rejects.toThrow('Cartesia API key is required');
    });

    it('should handle missing response body', async () => {
      fetchSpy = vi.fn().mockResolvedValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: null,
          headers: new Map(),
          text: () => Promise.resolve(''),
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test',
      });

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'cartesia',
        })) {
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

      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test-key',
      });

      const gen = provider.synthesize('Hello', { provider: 'cartesia' });
      const nextPromise = gen.next();
      provider.cancel();
      const result = await nextPromise;
      expect(result.done).toBe(true);
    });
  });

  describe('close', () => {
    it('should cancel and reset state', async () => {
      await provider.connect({
        provider: 'cartesia',
        apiKey: 'test-key',
      });
      expect(provider.isConnected()).toBe(true);

      await provider.close();
      expect(provider.isConnected()).toBe(false);
    });
  });

  it('getLastFirstByteLatency should return null initially', () => {
    expect(provider.getLastFirstByteLatency()).toBeNull();
  });

  it('createCartesiaTTSProvider should instantiate provider', () => {
    const p = createCartesiaTTSProvider({ apiUrl: 'custom.api.com' });
    expect(p).toBeInstanceOf(CartesiaTTSProvider);
    expect(p.name).toBe('cartesia');
  });
});
