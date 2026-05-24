import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioChunk } from '@reaatech/voice-agent-core';

const validChunk: AudioChunk = {
  buffer: Buffer.alloc(3200),
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
  timestamp: Date.now(),
};

describe('GroqWhisperSTTProvider', () => {
  let provider: any;

  beforeAll(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'transcribed text' }),
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    const { GroqWhisperSTTProvider } = await import('../src/adapters/groq-whisper.js');
    provider = new GroqWhisperSTTProvider();
  });

  afterEach(async () => {
    try {
      await provider.close();
    } catch {
      // ignore close errors
    }
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('groq-whisper');
      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect with valid config', async () => {
      await provider.connect({
        provider: 'groq-whisper',
        apiKey: 'test-key',
        sampleRate: 16000,
      });
      expect(provider.isConnected()).toBe(true);
    });

    it('should throw without API key', async () => {
      await expect(
        provider.connect({ provider: 'groq-whisper', sampleRate: 16000 }),
      ).rejects.toThrow('Groq API key is required');
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

    it('should accumulate audio chunks', async () => {
      await provider.connect({
        provider: 'groq-whisper',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      provider.streamAudio(validChunk);
      expect(provider.audioBuffer.length).toBe(1);
    });

    it('should not accumulate when not connected', () => {
      provider.streamAudio(validChunk);
      expect(provider.audioBuffer.length).toBe(0);
    });
  });

  describe('silence detection', () => {
    it('should flush audio on close with buffered data', async () => {
      await provider.connect({
        provider: 'groq-whisper',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      provider.streamAudio(validChunk);
      provider.streamAudio(validChunk);
      provider.streamAudio(validChunk);

      await provider.close();

      expect(fetch).toHaveBeenCalled();
    });

    it('should handle fetch error gracefully on close', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error')),
      );

      const errorCb = vi.fn();
      provider.onError(errorCb);

      await provider.connect({
        provider: 'groq-whisper',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      provider.streamAudio(validChunk);
      provider.streamAudio(validChunk);

      await provider.close();

      expect(errorCb).toHaveBeenCalled();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'transcribed text' }),
      }));
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await provider.connect({
        provider: 'groq-whisper',
        apiKey: 'test-key',
        sampleRate: 16000,
      });

      await provider.close();
      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('callback registration', () => {
    it('should register utterance callback', () => {
      const cb = vi.fn();
      provider.onUtterance(cb);
      provider.emit('utterance', { transcript: 'test', confidence: 0.9, isFinal: true, timestamp: Date.now() });
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
