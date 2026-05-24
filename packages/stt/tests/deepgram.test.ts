import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioChunk } from '@reaatech/voice-agent-core';

let lastWsInstance: any = null;

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((data: any) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;

    constructor(url: string, opts?: any) {
      lastWsInstance = this;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      });
    }

    on(event: string, handler: Function) {
      if (event === 'open') this.onopen = handler as () => void;
      else if (event === 'message') this.onmessage = handler as (data: any) => void;
      else if (event === 'close') this.onclose = handler as () => void;
      else if (event === 'error') this.onerror = handler as (err: any) => void;
    }

    send(_data: any) {}
    close(code?: number) {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
    removeAllListeners() {
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
    }
  }
  return { default: MockWebSocket };
});

import { DeepgramSTTProvider } from '../src/adapters/deepgram.js';

const validChunk: AudioChunk = {
  buffer: Buffer.from([0x00, 0x01, 0x02]),
  sampleRate: 8000,
  encoding: 'mulaw',
  channels: 1,
  timestamp: Date.now(),
};

describe('DeepgramSTTProvider', () => {
  let provider: DeepgramSTTProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    lastWsInstance = null;
    provider = new DeepgramSTTProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('deepgram');
      expect(provider.isConnected()).toBe(false);
    });

    it('should merge custom options', () => {
      const custom = new DeepgramSTTProvider({
        apiUrl: 'custom.deepgram.com',
        reconnectAttempts: 5,
        reconnectInterval: 2000,
      });
      expect((custom as any).options.apiUrl).toBe('custom.deepgram.com');
      expect((custom as any).options.reconnectAttempts).toBe(5);
      expect((custom as any).options.reconnectInterval).toBe(2000);
    });
  });

  describe('connect', () => {
    it('should connect with valid config', async () => {
      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw without API key', async () => {
      await expect(
        provider.connect({ provider: 'deepgram', sampleRate: 8000 }),
      ).rejects.toThrow('Deepgram API key is required');
    });
  });

  describe('streamAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.streamAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('Invalid audio chunk'));
    });

    it('should queue audio when not connected', () => {
      provider.streamAudio(validChunk);

      const queue = (provider as any).audioQueue;
      expect(queue.length).toBe(1);
      expect(queue[0]).toBe(validChunk);
    });

    it('should flush queue after connecting and send audio', async () => {
      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });

      if (lastWsInstance) {
        const sendSpy = vi.spyOn(lastWsInstance, 'send');
        provider.streamAudio(validChunk);
        expect(sendSpy).toHaveBeenCalledWith(validChunk.buffer);
      }
    });
  });

  describe('callback registration', () => {
    it('should register and fire utterance callback', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              channel: { alternatives: [{ transcript: 'hello world', confidence: 0.95 }] },
              is_final: true,
            }),
          ),
        );

        expect(utteranceCb).toHaveBeenCalledWith(
          expect.objectContaining({
            transcript: 'hello world',
            confidence: 0.95,
            isFinal: true,
          }),
        );
      }
    });

    it('should fire endOfSpeech on speech_final', async () => {
      const endOfSpeechCb = vi.fn();
      provider.onEndOfSpeech(endOfSpeechCb);

      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              channel: { alternatives: [{ transcript: 'test', confidence: 0.9 }] },
              is_final: true,
              speech_final: true,
            }),
          ),
        );

        expect(endOfSpeechCb).toHaveBeenCalled();
      }
    });

    it('should fire error callback on parse error', async () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(Buffer.from('invalid json'));

        expect(errorCb).toHaveBeenCalled();
      }
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      expect(provider.isConnected()).toBe(false);
    });

    it('should return true after connect', async () => {
      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });
      expect(provider.isConnected()).toBe(true);
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await provider.connect({
        provider: 'deepgram',
        apiKey: 'test-key',
        sampleRate: 8000,
      });

      expect(provider.isConnected()).toBe(true);
      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect((provider as any).ws).toBeNull();
      expect((provider as any).audioQueue).toEqual([]);
    });
  });

  describe('createDeepgramSTTProvider', () => {
    it('should be a factory function', async () => {
      const { createDeepgramSTTProvider } = await import('../src/adapters/deepgram.js');
      const instance = createDeepgramSTTProvider({ apiUrl: 'test.api' });
      expect(instance).toBeInstanceOf(DeepgramSTTProvider);
    });
  });
});
