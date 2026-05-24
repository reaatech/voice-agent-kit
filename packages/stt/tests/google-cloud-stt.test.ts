import type { AudioChunk } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamHandlers: Record<string, Function[]> = {};

vi.mock('@google-cloud/speech', () => {
  const mockStream = {
    on: vi.fn((event: string, handler: Function) => {
      if (!streamHandlers[event]) streamHandlers[event] = [];
      streamHandlers[event].push(handler);
      return mockStream;
    }),
    write: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    SpeechClient: vi.fn().mockImplementation(() => ({
      streamingRecognize: vi.fn().mockReturnValue(mockStream),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('GoogleCloudSTTProvider', () => {
  let provider: any;
  let GoogleCloudSTTProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(streamHandlers)) {
      delete streamHandlers[k];
    }
    const mod = await import('../src/adapters/google-cloud-stt.js');
    GoogleCloudSTTProvider = mod.GoogleCloudSTTProvider;
    provider = new GoogleCloudSTTProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  function fireDataEvent(data: unknown) {
    const handlers = streamHandlers.data;
    if (handlers) {
      for (const h of handlers) {
        h(data);
      }
    }
  }

  function fireErrorEvent(error: Error) {
    const handlers = streamHandlers.error;
    if (handlers) {
      for (const h of handlers) {
        h(error);
      }
    }
  }

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('google-cloud-stt');
      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should throw without credentials', async () => {
      await expect(
        provider.connect({
          provider: 'google-cloud-stt',
          sampleRate: 8000,
        }),
      ).rejects.toThrow('Google Cloud credentials are required');
    });

    it('should connect with API key', async () => {
      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });
      expect(provider.isConnected()).toBe(true);
    });
  });

  describe('streamAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.streamAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('Invalid audio chunk'));
    });

    it('should queue audio when not connected', () => {
      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      };
      provider.streamAudio(chunk);
      expect(provider.audioQueue.length).toBe(1);
    });

    it('should write audio to stream when connected', async () => {
      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      };

      const stream = provider.recognizeStream;
      provider.streamAudio(chunk);

      expect(stream.write).toHaveBeenCalledWith(chunk.buffer);
    });

    it('should convert mulaw to linear16 before writing', async () => {
      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      const chunk: AudioChunk = {
        buffer: Buffer.from([0xff]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      const stream = provider.recognizeStream;
      provider.streamAudio(chunk);

      expect(stream.write).toHaveBeenCalled();
      expect(stream.write.mock.calls[0][0].length).toBe(2);
    });
  });

  describe('recognition response handling', () => {
    it('should emit utterance on transcript data', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      fireDataEvent({
        results: [
          {
            alternatives: [{ transcript: 'hello world', confidence: 0.95 }],
            isFinal: true,
          },
        ],
      });

      expect(utteranceCb).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: 'hello world',
          confidence: 0.95,
          isFinal: true,
        }),
      );
    });

    it('should emit endOfSpeech on final result', async () => {
      const endOfSpeechCb = vi.fn();
      provider.onEndOfSpeech(endOfSpeechCb);

      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      fireDataEvent({
        results: [
          {
            alternatives: [{ transcript: 'done', confidence: 0.9 }],
            isFinal: true,
          },
        ],
      });

      expect(endOfSpeechCb).toHaveBeenCalled();
    });

    it('should not emit utterance for empty results', async () => {
      const utteranceCb = vi.fn();
      provider.onUtterance(utteranceCb);

      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      fireDataEvent({ results: [] });
      expect(utteranceCb).not.toHaveBeenCalled();

      fireDataEvent({});
      expect(utteranceCb).not.toHaveBeenCalled();
    });

    it('should emit error on stream error', async () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      fireErrorEvent(new Error('Stream error'));

      expect(errorCb).toHaveBeenCalledWith(new Error('Stream error'));
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await provider.connect({
        provider: 'google-cloud-stt',
        apiKey: 'test-api-key',
        projectId: 'test-project',
        sampleRate: 8000,
      });

      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect(provider.recognizeStream).toBeNull();
    });
  });

  describe('callback registration', () => {
    it('should register utterance callback', () => {
      const cb = vi.fn();
      provider.onUtterance(cb);
      provider.emit('utterance', {
        transcript: 'test',
        confidence: 0.9,
        isFinal: true,
        timestamp: Date.now(),
      });
      expect(cb).toHaveBeenCalled();
    });

    it('should register endOfSpeech callback', () => {
      const cb = vi.fn();
      provider.onEndOfSpeech(cb);
      provider.emit('endOfSpeech');
      expect(cb).toHaveBeenCalled();
    });

    it('should register error callback', () => {
      const cb = vi.fn();
      provider.onError(cb);
      provider.emit('error', new Error('test'));
      expect(cb).toHaveBeenCalled();
    });
  });
});
