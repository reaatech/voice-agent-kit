import { beforeEach, describe, expect, it } from 'vitest';
import { DeepgramTTSProvider } from '../src/adapters/deepgram.js';
import type { TTSProvider } from '../src/interface.js';
import { TTSProviderInterface } from '../src/interface.js';

describe('TTSProvider Interface', () => {
  describe('DeepgramTTSProvider', () => {
    let provider: TTSProvider;

    beforeEach(() => {
      provider = new DeepgramTTSProvider();
    });

    it('should have a name property', () => {
      expect(provider.name).toBe('deepgram');
    });

    it('should have supportsStreaming property', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should have firstByteLatencyMs property', () => {
      expect(provider.firstByteLatencyMs).toBeNull();
    });

    it('should implement synthesize method', async () => {
      const result = provider.synthesize('Hello world', {
        voice: 'asteria',
        model: 'aura',
      });
      expect(result).toBeDefined();
      expect(Symbol.asyncIterator in result).toBe(true);
    });

    it('should implement cancel method', () => {
      expect(() => provider.cancel()).not.toThrow();
    });

    it('should produce audio chunks from text', () => {
      const result = provider.synthesize('Test', { voice: 'asteria' });
      expect(result).toBeDefined();
      expect(Symbol.asyncIterator in result).toBe(true);
    });
  });

  describe('TTSProviderInterface utilities', () => {
    describe('formatAudioForTwilio', () => {
      it('should passthrough mulaw 8kHz audio', () => {
        const chunk = {
          buffer: Buffer.from([0x7f, 0x80, 0xff]),
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = TTSProviderInterface.formatAudioForTwilio(chunk);
        expect(result).toBe(chunk);
        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(8000);
      });

      it('should convert linear16 16kHz audio to mulaw 8kHz', () => {
        const numSamples = 4;
        const linear16Buffer = Buffer.alloc(numSamples * 2);
        for (let i = 0; i < numSamples; i++) {
          linear16Buffer.writeInt16LE(100 * (i + 1), i * 2);
        }

        const chunk = {
          buffer: linear16Buffer,
          sampleRate: 16000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = TTSProviderInterface.formatAudioForTwilio(chunk);
        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(8000);
        expect(Buffer.isBuffer(result.buffer)).toBe(true);
        expect(result.buffer.length).toBeGreaterThan(0);
        expect(result.buffer).not.toBe(linear16Buffer);
      });

      it('should handle pcm encoding', () => {
        const pcmBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
        const chunk = {
          buffer: pcmBuffer,
          sampleRate: 16000,
          encoding: 'pcm' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = TTSProviderInterface.formatAudioForTwilio(chunk);
        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(8000);
        expect(Buffer.isBuffer(result.buffer)).toBe(true);
      });
    });

    describe('createSilenceChunk', () => {
      it('should produce correct duration silence chunk', () => {
        const durationMs = 100;
        const sampleRate = 8000;
        const result = TTSProviderInterface.createSilenceChunk(durationMs, sampleRate);

        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(sampleRate);
        expect(result.channels).toBe(1);
        expect(result.buffer.length).toBe(Math.ceil((sampleRate / 1000) * durationMs * 1));
        expect(result.timestamp).toBeGreaterThan(0);

        const allSilence = result.buffer.every((byte) => byte === 0x7f);
        expect(allSilence).toBe(true);
      });

      it('should default to 8000 sample rate', () => {
        const result = TTSProviderInterface.createSilenceChunk(50);
        expect(result.sampleRate).toBe(8000);
      });
    });

    describe('chunkTextForStreaming', () => {
      it('should split text at sentence boundaries', () => {
        const text = 'Hello world. How are you? I am fine. Good bye!';
        const chunks = TTSProviderInterface.chunkTextForStreaming(text, 15);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((c) => c.length > 0)).toBe(true);
      });

      it('should return single chunk for short text', () => {
        const text = 'Hello world.';
        const chunks = TTSProviderInterface.chunkTextForStreaming(text);

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toBe('Hello world.');
      });

      it('should respect maxChunkSize parameter', () => {
        const text = 'A short sentence. Another one here. And a third one.';
        const maxChunkSize = 20;
        const chunks = TTSProviderInterface.chunkTextForStreaming(text, maxChunkSize);

        expect(chunks.length).toBeGreaterThanOrEqual(3);
        chunks.forEach((chunk) => {
          expect(chunk.length).toBeLessThanOrEqual(maxChunkSize + 1);
        });
      });

      it('should handle empty text', () => {
        const chunks = TTSProviderInterface.chunkTextForStreaming('');
        expect(chunks).toEqual([]);
      });

      it('should handle text without punctuation', () => {
        const text =
          'this is a long string with no punctuation that should exceed the default max chunk size';
        const chunks = TTSProviderInterface.chunkTextForStreaming(text, 20);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
        expect(chunks.some((c) => c.length > 0)).toBe(true);
      });
    });
  });
});
