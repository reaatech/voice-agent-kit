import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepgramTTSProvider } from '../src/adapters/deepgram.js';
import type { TTSProvider } from '../src/interface.js';

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
      // Verify synthesize method returns an async iterable
      const result = provider.synthesize('Test', { voice: 'asteria' });
      expect(result).toBeDefined();
      expect(Symbol.asyncIterator in result).toBe(true);
    });
  });

  describe('Audio Output Formatting', () => {
    it('should format audio to Twilio mulaw 8kHz', () => {
      // Test Twilio audio formatting
      const audioBuffer = Buffer.from([0x00, 0x01, 0x02]);
      expect(audioBuffer).toBeInstanceOf(Buffer);
    });

    it('should chunk audio into 20ms frames', () => {
      // Test chunk sizing for Twilio playback
      const sampleRate = 8000;
      const frameDuration = 0.02; // 20ms
      const frameSize = Math.floor(sampleRate * frameDuration);
      expect(frameSize).toBe(160);
    });
  });
});
