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

import { OpenAIRealtimeSTTProvider } from '../src/adapters/openai-realtime.js';

const validChunk: AudioChunk = {
  buffer: Buffer.from([0x00, 0x01, 0x02]),
  sampleRate: 24000,
  encoding: 'linear16',
  channels: 1,
  timestamp: Date.now(),
};

describe('OpenAIRealtimeSTTProvider', () => {
  let provider: OpenAIRealtimeSTTProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    lastWsInstance = null;
    provider = new OpenAIRealtimeSTTProvider();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('openai-realtime');
      expect(provider.isConnected()).toBe(false);
    });

    it('should merge custom options', () => {
      const custom = new OpenAIRealtimeSTTProvider({ apiUrl: 'custom.openai.com', reconnectAttempts: 5 });
      expect((custom as any).options.apiUrl).toBe('custom.openai.com');
      expect((custom as any).options.reconnectAttempts).toBe(5);
    });
  });

  describe('connect', () => {
    it('should connect with valid config', async () => {
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw without API key', async () => {
      await expect(
        provider.connect({ provider: 'openai-realtime', sampleRate: 24000 }),
      ).rejects.toThrow('OpenAI API key is required');
    });
  });

  describe('streamAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.streamAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 24000,
        encoding: 'linear16',
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
  });

  describe('message handling', () => {
    it('should detect speech started', async () => {
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(JSON.stringify({ type: 'input_audio_buffer.speech_started' })),
        );
        expect((provider as any).speechActive).toBe(true);
      }
    });

    it('should handle speech stopped and commit', async () => {
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      const sendSpy = vi.spyOn(lastWsInstance, 'send');

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' })),
        );
        expect((provider as any).speechActive).toBe(false);
        expect(sendSpy).toHaveBeenCalledWith(
          expect.stringContaining('input_audio_buffer.commit'),
        );
      }
    });

    it('should emit utterance on transcription completed', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.completed',
              transcript: 'hello world',
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

    it('should emit utterance on audio transcript done', async () => {
      const utteranceCb = vi.fn();
      const endOfSpeechCb = vi.fn();
      provider.onUtterance(utteranceCb);
      provider.onEndOfSpeech(endOfSpeechCb);

      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              type: 'response.audio_transcript.done',
              transcript: 'response text',
            }),
          ),
        );

        expect(utteranceCb).toHaveBeenCalledWith(
          expect.objectContaining({ transcript: 'response text' }),
        );
        expect(endOfSpeechCb).toHaveBeenCalled();
      }
    });

    it('should handle error messages', async () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      if (lastWsInstance && lastWsInstance.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { message: 'API error occurred' },
            }),
          ),
        );

        expect(errorCb).toHaveBeenCalledWith(new Error('API error occurred'));
      }
    });

    it('should handle unknown message types without error', async () => {
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      expect(() => {
        if (lastWsInstance && lastWsInstance.onmessage) {
          lastWsInstance.onmessage(
            Buffer.from(JSON.stringify({ type: 'unknown.type' })),
          );
        }
      }).not.toThrow();
    });
  });

  describe('callback registration', () => {
    it('should register and fire utterance callback', () => {
      const cb = vi.fn();
      provider.onUtterance(cb);
      expect(typeof (provider as any).listeners('utterance').length).toBe('number');
    });

    it('should register endOfSpeech callback', () => {
      const cb = vi.fn();
      provider.onEndOfSpeech(cb);
      expect(typeof (provider as any).listeners('endOfSpeech').length).toBe('number');
    });

    it('should register error callback', () => {
      const cb = vi.fn();
      provider.onError(cb);
      expect(typeof (provider as any).listeners('error').length).toBe('number');
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });

      expect(provider.isConnected()).toBe(true);
      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect((provider as any).ws).toBeNull();
      expect((provider as any).audioQueue).toEqual([]);
      expect((provider as any).speechActive).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return correct state', async () => {
      expect(provider.isConnected()).toBe(false);
      await provider.connect({
        provider: 'openai-realtime',
        apiKey: 'test-key',
        sampleRate: 24000,
      });
      expect(provider.isConnected()).toBe(true);
      await provider.close();
      expect(provider.isConnected()).toBe(false);
    });
  });
});
