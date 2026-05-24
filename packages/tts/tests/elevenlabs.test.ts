import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElevenLabsTTSProvider, ElevenLabsTTSProvider } from '../src/adapters/elevenlabs.js';
import type { ElevenLabsConfig } from '../src/interface.js';

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

describe('ElevenLabsTTSProvider', () => {
  let provider: ElevenLabsTTSProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new ElevenLabsTTSProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      const p = new ElevenLabsTTSProvider();
      expect(p.name).toBe('elevenlabs');
      expect(p.supportsStreaming).toBe(true);
      expect(p.firstByteLatencyMs).toBeNull();
    });

    it('should accept custom apiUrl', () => {
      const p = new ElevenLabsTTSProvider({ apiUrl: 'custom.elevenlabs.io' });
      expect(p.name).toBe('elevenlabs');
    });
  });

  describe('connect', () => {
    it('should validate API key and set connected', async () => {
      await provider.connect({ provider: 'elevenlabs', apiKey: 'valid-key' });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw on missing API key', async () => {
      await expect(provider.connect({ provider: 'elevenlabs' })).rejects.toThrow(
        'ElevenLabs API key is required',
      );
    });

    it('should use env var for API key', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'env-key');
      await provider.connect({ provider: 'elevenlabs' });
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

    it('should send correct request to ElevenLabs API', async () => {
      const audioData = new Uint8Array([0x7f, 0x80]);
      setupMockStream(audioData);

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test-key' });

      const config: ElevenLabsConfig = {
        provider: 'elevenlabs',
        voiceId: '21m00Tcm4TlvDq8ikWAM',
        modelId: 'eleven_flash_v2_5',
        outputFormat: 'mulaw_8000',
      };

      const chunks: Array<unknown> = [];
      for await (const chunk of provider.synthesize('Hello world', config)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain('api.elevenlabs.io');
      expect(callUrl).toContain('/v1/text-to-speech/');
      expect(callUrl).toContain('/stream');

      const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['xi-api-key']).toBe('test-key');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(callInit.body as string);
      expect(body.text).toBe('Hello world');
      expect(body.model_id).toBe('eleven_flash_v2_5');
    });

    it('should include optimize_streaming_latency=4 in URL', async () => {
      setupMockStream(new Uint8Array([0x01]));

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test-key' });

      const config: ElevenLabsConfig = {
        provider: 'elevenlabs',
      };

      for await (const _ of provider.synthesize('Hello', config)) {
        // consume
      }

      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain('optimize_streaming_latency=4');
    });

    it('should handle different output formats in URL', async () => {
      setupMockStream(new Uint8Array([0x00, 0x01]));

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test' });

      const config: ElevenLabsConfig = {
        provider: 'elevenlabs',
        outputFormat: 'pcm_16000',
      };

      for await (const _ of provider.synthesize('test', config)) {
        // consume
      }

      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain('output_format=pcm_16000');
    });

    it('should include voice settings when provided', async () => {
      setupMockStream(new Uint8Array([0x01]));

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test-key' });

      const config: ElevenLabsConfig = {
        provider: 'elevenlabs',
        voiceSettings: {
          stability: 0.5,
          similarityBoost: 0.8,
        },
      };

      for await (const _ of provider.synthesize('Hello', config)) {
        // consume
      }

      const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.voice_settings).toBeDefined();
      expect(body.voice_settings.stability).toBe(0.5);
      expect(body.voice_settings.similarityBoost).toBe(0.8);
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

      await provider.connect({ provider: 'elevenlabs', apiKey: 'bad-key' });

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'elevenlabs',
        })) {
          // noop
        }
      }).rejects.toThrow('ElevenLabs TTS error');
    });

    it('should throw when no API key available', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '');
      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'elevenlabs',
        })) {
          // noop
        }
      }).rejects.toThrow('ElevenLabs API key is required');
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

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test' });

      await expect(async () => {
        for await (const _ of provider.synthesize('Hello', {
          provider: 'elevenlabs',
        })) {
          // noop
        }
      }).rejects.toThrow('No response body');
    });
  });

  describe('cancel', () => {
    it('should abort in-progress synthesis', async () => {
      const fetchSpy = vi.fn().mockImplementation(
        (_url, options) =>
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

      await provider.connect({ provider: 'elevenlabs', apiKey: 'test-key' });

      const gen = provider.synthesize('Hello', { provider: 'elevenlabs' });
      const nextPromise = gen.next();
      provider.cancel();
      const result = await nextPromise;
      expect(result.done).toBe(true);
    });
  });

  describe('close', () => {
    it('should cancel and reset state', async () => {
      await provider.connect({ provider: 'elevenlabs', apiKey: 'test-key' });
      expect(provider.isConnected()).toBe(true);

      await provider.close();
      expect(provider.isConnected()).toBe(false);
    });
  });

  it('getLastFirstByteLatency should return null initially', () => {
    expect(provider.getLastFirstByteLatency()).toBeNull();
  });

  it('createElevenLabsTTSProvider should instantiate provider', () => {
    const p = createElevenLabsTTSProvider({ apiUrl: 'custom.api.com' });
    expect(p).toBeInstanceOf(ElevenLabsTTSProvider);
    expect(p.name).toBe('elevenlabs');
  });
});
