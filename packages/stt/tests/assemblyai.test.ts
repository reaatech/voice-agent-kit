import type { AudioChunk } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    constructor(_url: string, _opts?: any) {
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
    close(_code?: number) {
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

import { AssemblyAIProvider } from '../src/adapters/assemblyai.js';

const validChunk: AudioChunk = {
  buffer: Buffer.from([0x00, 0x01, 0x02]),
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
  timestamp: Date.now(),
};

describe('AssemblyAIProvider', () => {
  let provider: AssemblyAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    lastWsInstance = null;
    provider = new AssemblyAIProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('assemblyai');
      expect(provider.isConnected()).toBe(false);
    });

    it('should merge custom options', () => {
      const custom = new AssemblyAIProvider({
        apiUrl: 'custom.assemblyai.com',
        reconnectAttempts: 5,
      });
      expect((custom as any).options.apiUrl).toBe('custom.assemblyai.com');
      expect((custom as any).options.reconnectAttempts).toBe(5);
    });
  });

  describe('connect', () => {
    it('should connect with valid config', async () => {
      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw without API key', async () => {
      await expect(provider.connect({ provider: 'assemblyai', sampleRate: 16000 })).rejects.toThrow(
        'AssemblyAI API key is required',
      );
    });
  });

  describe('streamAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.streamAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 16000,
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
    });
  });

  describe('message handling', () => {
    it('should emit partial transcript', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      if (lastWsInstance?.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              message_type: 'PartialTranscript',
              text: 'partial text',
              confidence: 0.7,
            }),
          ),
        );

        expect(utteranceCb).toHaveBeenCalledWith(
          expect.objectContaining({ transcript: 'partial text', isFinal: false }),
        );
      }
    });

    it('should emit final transcript on FinalTranscript', async () => {
      const utteranceCb = vi.fn();
      const endOfSpeechCb = vi.fn();
      provider.onUtterance(utteranceCb);
      provider.onEndOfSpeech(endOfSpeechCb);

      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      if (lastWsInstance?.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              message_type: 'FinalTranscript',
              text: 'final text',
              confidence: 0.95,
            }),
          ),
        );

        expect(utteranceCb).toHaveBeenCalledWith(
          expect.objectContaining({ transcript: 'final text', isFinal: true }),
        );
        expect(endOfSpeechCb).toHaveBeenCalled();
      }
    });

    it('should not emit empty transcripts', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      if (lastWsInstance?.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(
            JSON.stringify({
              message_type: 'PartialTranscript',
              text: '   ',
            }),
          ),
        );

        expect(utteranceCb).not.toHaveBeenCalled();
      }
    });

    it('should handle SessionTerminated', async () => {
      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      expect(provider.isConnected()).toBe(true);

      if (lastWsInstance?.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(JSON.stringify({ message_type: 'SessionTerminated' })),
        );

        expect(provider.isConnected()).toBe(false);
      }
    });

    it('should handle Error message', async () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      if (lastWsInstance?.onmessage) {
        lastWsInstance.onmessage(
          Buffer.from(JSON.stringify({ message_type: 'Error', text: 'API error' })),
        );

        expect(errorCb).toHaveBeenCalledWith(new Error('API error'));
      }
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect((provider as any).ws).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return correct state', async () => {
      expect(provider.isConnected()).toBe(false);
      await provider.connect({
        provider: 'assemblyai',
        apiKey: 'test-key',
        sampleRate: 16000,
      });
      expect(provider.isConnected()).toBe(true);
    });
  });
});
