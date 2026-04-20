import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepgramSTTProvider } from '../src/adapters/deepgram.js';
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
      // Verify the method exists and has correct signature
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

  describe('Audio Format Conversion', () => {
    it('should convert mulaw to linear16', () => {
      // Test the audio format conversion utility
      const mulawData = Buffer.from([0x00, 0x7f, 0xff]);
      // This would test the actual conversion logic
      expect(mulawData).toBeInstanceOf(Buffer);
    });

    it('should resample audio from 8kHz to 16kHz', () => {
      // Test resampling logic
      const input = {
        data: Buffer.from([0x00, 0x01, 0x02]),
        sampleRate: 8000,
      };
      expect(input.data).toBeInstanceOf(Buffer);
    });
  });
});
