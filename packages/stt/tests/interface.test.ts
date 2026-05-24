import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepgramSTTProvider } from '../src/adapters/deepgram.js';
import { STTProviderInterface } from '../src/interface.js';
import type { STTProvider } from '../src/interface.js';

describe('STTProvider Interface', () => {
  describe('DeepgramSTTProvider', () => {
    let provider: STTProvider;

    beforeEach(() => {
      provider = new DeepgramSTTProvider();
    });

    afterEach(async () => {
      await provider.close();
    });

    it('should have a name property', () => {
      expect(provider.name).toBe('deepgram');
    });

    it('should implement connect method', () => {
      expect(typeof provider.connect).toBe('function');
    });

    it('should implement streamAudio method', () => {
      const chunk = {
        buffer: Buffer.from([0x00, 0x01, 0x02]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };
      expect(() => provider.streamAudio(chunk)).not.toThrow();
    });

    it('should implement onUtterance callback registration', () => {
      const callback = vi.fn();
      expect(() => provider.onUtterance(callback)).not.toThrow();
    });

    it('should implement onEndOfSpeech callback registration', () => {
      const callback = vi.fn();
      expect(() => provider.onEndOfSpeech(callback)).not.toThrow();
    });

    it('should implement close method', async () => {
      await expect(provider.close()).resolves.not.toThrow();
    });
  });

  describe('STTProviderInterface', () => {
    describe('validateAudioChunk', () => {
      it('should return true for valid audio chunk', () => {
        const chunk = {
          buffer: Buffer.from([0x00, 0x01, 0x02]),
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        expect(STTProviderInterface.validateAudioChunk(chunk)).toBe(true);
      });

      it('should return false if buffer is not a Buffer', () => {
        const chunk = {
          buffer: 'not-a-buffer' as unknown as Buffer,
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        expect(STTProviderInterface.validateAudioChunk(chunk)).toBe(false);
      });

      it('should return false for empty buffer', () => {
        const chunk = {
          buffer: Buffer.from([]),
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        expect(STTProviderInterface.validateAudioChunk(chunk)).toBe(false);
      });

      it('should return false for zero sample rate', () => {
        const chunk = {
          buffer: Buffer.from([0x00]),
          sampleRate: 0,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        expect(STTProviderInterface.validateAudioChunk(chunk)).toBe(false);
      });

      it('should return false if sampleRate is not a number', () => {
        const chunk = {
          buffer: Buffer.from([0x00]),
          sampleRate: '8000' as unknown as number,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        expect(STTProviderInterface.validateAudioChunk(chunk)).toBe(false);
      });
    });

    describe('mulawToLinear16', () => {
      it('should produce a buffer twice the size of input', () => {
        const input = Buffer.from([0x00, 0x7f, 0xff]);
        const result = STTProviderInterface.mulawToLinear16(input);
        expect(result.length).toBe(input.length * 2);
      });

      it('should handle empty input', () => {
        const input = Buffer.from([]);
        const result = STTProviderInterface.mulawToLinear16(input);
        expect(result.length).toBe(0);
      });

      it('should produce deterministic non-zero values', () => {
        const input = Buffer.from([0xff, 0x00, 0x7f, 0x80]);
        const result = STTProviderInterface.mulawToLinear16(input);
        expect(result.length).toBe(8);
        const sample0 = result.readInt16LE(0);
        const sample1 = result.readInt16LE(2);
        expect(typeof sample0).toBe('number');
        expect(typeof sample1).toBe('number');
      });
    });

    describe('convertAudioFormat', () => {
      it('should convert mulaw to linear16', () => {
        const chunk = {
          buffer: Buffer.from([0xff, 0x00]),
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 8000, 'linear16');
        expect(result.encoding).toBe('linear16');
        expect(result.sampleRate).toBe(8000);
        expect(result.buffer.length).toBe(4);
      });

      it('should convert linear16 to mulaw', () => {
        const chunk = {
          buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]),
          sampleRate: 8000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 8000, 'mulaw');
        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(8000);
        expect(result.buffer.length).toBe(2);
      });

      it('should resample when target rate differs (8kHz to 16kHz)', () => {
        const chunk = {
          buffer: Buffer.alloc(320),
          sampleRate: 8000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 16000, 'linear16');
        expect(result.sampleRate).toBe(16000);
        expect(result.encoding).toBe('linear16');
        expect(result.buffer.length).toBeGreaterThan(chunk.buffer.length);
      });

      it('should resample when target rate differs (16kHz to 8kHz)', () => {
        const chunk = {
          buffer: Buffer.alloc(320),
          sampleRate: 16000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 8000, 'linear16');
        expect(result.sampleRate).toBe(8000);
        expect(result.buffer.length).toBeLessThan(chunk.buffer.length);
      });

      it('should return same buffer when no conversion needed', () => {
        const chunk = {
          buffer: Buffer.from([0x00, 0x01, 0x02]),
          sampleRate: 8000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 8000, 'linear16');
        expect(result.encoding).toBe('linear16');
        expect(result.sampleRate).toBe(8000);
        expect(result.buffer).toBe(chunk.buffer);
      });

      it('should convert mulaw with resampling', () => {
        const chunk = {
          buffer: Buffer.from([0xff, 0x00, 0x7f]),
          sampleRate: 8000,
          encoding: 'mulaw' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 16000, 'linear16');
        expect(result.encoding).toBe('linear16');
        expect(result.sampleRate).toBe(16000);
      });

      it('should convert linear16 with mulaw encoding', () => {
        const chunk = {
          buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]),
          sampleRate: 8000,
          encoding: 'linear16' as const,
          channels: 1,
          timestamp: Date.now(),
        };
        const result = STTProviderInterface.convertAudioFormat(chunk, 16000, 'mulaw');
        expect(result.encoding).toBe('mulaw');
        expect(result.sampleRate).toBe(16000);
      });
    });
  });
});
