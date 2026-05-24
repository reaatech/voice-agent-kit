import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ThinkingAudioManager,
  generateFillerTone,
  linear16ToMulaw,
} from '../src/pipeline/thinking-audio.js';
import type { AudioChunk } from '../src/types/index.js';

describe('ThinkingAudioManager', () => {
  describe('constructor', () => {
    it('should apply default configuration', () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager({ enabled: true, strategy: 'filler' }, onSendAudio);

      expect(manager).toBeInstanceOf(ThinkingAudioManager);
    });

    it('should merge provided config with defaults', () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'filler', fillerToneHz: 660, fillerVolume: 0.2, maxDurationMs: 500 },
        onSendAudio,
      );

      expect(manager).toBeInstanceOf(ThinkingAudioManager);
    });
  });

  describe('startThinking with strategy: none', () => {
    it('should not start when strategy is none', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'none' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('should not start when disabled', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: false, strategy: 'filler' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).not.toHaveBeenCalled();
      manager.destroy();
    });
  });

  describe('startThinking with strategy: silence', () => {
    it('should send a silence chunk', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).toHaveBeenCalledTimes(1);
      const sentChunk = onSendAudio.mock.calls[0][0] as AudioChunk;
      expect(sentChunk.encoding).toBe('mulaw');
      expect(sentChunk.sampleRate).toBe(8000);

      manager.destroy();
    });
  });

  describe('startThinking with strategy: filler', () => {
    it('should send filler audio chunks', async () => {
      vi.useFakeTimers();
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'filler', fillerToneHz: 440, fillerVolume: 0.1, maxDurationMs: 500 },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      // Immediate first chunk
      expect(onSendAudio).toHaveBeenCalledTimes(1);

      // Advance timer for filler interval
      vi.advanceTimersByTime(160);
      expect(onSendAudio).toHaveBeenCalledTimes(2);

      // Advance enough to exceed max duration
      vi.advanceTimersByTime(400);
      // Should have stopped due to max duration
      const callsAtMax = onSendAudio.mock.calls.length;

      vi.advanceTimersByTime(200);
      // Should not increase since stopped
      expect(onSendAudio.mock.calls.length).toBe(callsAtMax);

      manager.destroy();
      vi.useRealTimers();
    });

    it('should send mulaw encoded audio chunks', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'filler', fillerToneHz: 440, fillerVolume: 0.1, maxDurationMs: 800 },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).toHaveBeenCalled();
      const chunk = onSendAudio.mock.calls[0][0] as AudioChunk;
      expect(chunk.encoding).toBe('mulaw');
      expect(chunk.sampleRate).toBe(8000);
      expect(chunk.channels).toBe(1);
      expect(chunk.buffer.length).toBeGreaterThan(0);

      manager.destroy();
    });
  });

  describe('startThinking with strategy: backchannel', () => {
    it('should not send anything when no phrases configured', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'backchannel', backchannelPhrases: [] },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('should send silence and set timeout', async () => {
      vi.useFakeTimers();
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        {
          enabled: true,
          strategy: 'backchannel',
          backchannelPhrases: ['Sure', 'I see', 'Go on'],
          maxDurationMs: 300,
        },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(onSendAudio).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(400);

      // After timeout, thinking should have stopped
      expect(manager.isActive('turn-1')).toBe(false);

      manager.destroy();
      vi.useRealTimers();
    });
  });

  describe('isActive', () => {
    it('should return false for non-existent turn', () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'none' },
        onSendAudio,
      );

      expect(manager.isActive('non-existent')).toBe(false);
      manager.destroy();
    });

    it('should return true for an active turn', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');

      expect(manager.isActive('turn-1')).toBe(true);
      manager.destroy();
    });
  });

  describe('stopThinking', () => {
    it('should stop a thinking turn', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');
      expect(manager.isActive('turn-1')).toBe(true);

      manager.stopThinking('turn-1');
      expect(manager.isActive('turn-1')).toBe(false);
      manager.destroy();
    });

    it('should do nothing for non-existent turn', () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      expect(() => manager.stopThinking('non-existent')).not.toThrow();
      manager.destroy();
    });

    it('should stop filler audio immediately', async () => {
      vi.useFakeTimers();
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'filler', fillerToneHz: 440, fillerVolume: 0.1, maxDurationMs: 5000 },
        onSendAudio,
      );

      await manager.startThinking('turn-1');
      expect(onSendAudio).toHaveBeenCalledTimes(1);

      // Let a few intervals fire
      vi.advanceTimersByTime(320);
      expect(onSendAudio.mock.calls.length).toBeGreaterThanOrEqual(2);

      manager.stopThinking('turn-1');

      const afterStop = onSendAudio.mock.calls.length;

      // Advance far more - should not increase
      vi.advanceTimersByTime(1000);
      expect(onSendAudio.mock.calls.length).toBe(afterStop);

      manager.destroy();
      vi.useRealTimers();
    });
  });

  describe('destroy', () => {
    it('should stop all active turns', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');
      await manager.startThinking('turn-2');

      manager.destroy();

      expect(manager.isActive('turn-1')).toBe(false);
    });

    it('should prevent new thinking after destroy', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      manager.destroy();

      await manager.startThinking('turn-1');

      expect(onSendAudio).not.toHaveBeenCalled();
    });
  });

  describe('startThinking idempotency', () => {
    it('should not start duplicate thinking for the same turn', async () => {
      const onSendAudio = vi.fn();
      const manager = new ThinkingAudioManager(
        { enabled: true, strategy: 'silence' },
        onSendAudio,
      );

      await manager.startThinking('turn-1');
      await manager.startThinking('turn-1');

      expect(onSendAudio).toHaveBeenCalledTimes(1);
      manager.destroy();
    });
  });
});

describe('generateFillerTone', () => {
  it('should produce a buffer of correct length', () => {
    const durationMs = 160;
    const sampleRate = 8000;
    const tone = generateFillerTone(durationMs, 440, 0.1, sampleRate);

    const expectedLength = Math.floor((sampleRate / 1000) * durationMs);
    expect(tone.length).toBe(expectedLength);
  });

  it('should produce mulaw encoded audio', () => {
    const tone = generateFillerTone(160, 440, 0.1, 8000);
    expect(Buffer.isBuffer(tone)).toBe(true);
    // Each sample should be 0-255 (mulaw 8-bit)
    for (let i = 0; i < tone.length; i++) {
      expect(tone[i]).toBeGreaterThanOrEqual(0);
      expect(tone[i]).toBeLessThanOrEqual(255);
    }
  });

  it('should produce different outputs for different frequencies', () => {
    const tone440 = generateFillerTone(160, 440, 0.1, 8000);
    const tone880 = generateFillerTone(160, 880, 0.1, 8000);

    const isDifferent = !tone440.equals(tone880);
    expect(isDifferent).toBe(true);
  });

  it('should handle zero volume', () => {
    const tone = generateFillerTone(160, 440, 0, 8000);
    // At zero volume, samples should be near-silence (mulaw value ~0x7f)
    expect(tone.length).toBeGreaterThan(0);
  });
});

describe('linear16ToMulaw', () => {
  it('should convert positive samples', () => {
    const result = linear16ToMulaw(100);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(255);
  });

  it('should convert negative samples', () => {
    const result = linear16ToMulaw(-100);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(255);
  });

  it('should clamp large positive values', () => {
    const result = linear16ToMulaw(32000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(255);
  });

  it('should handle zero', () => {
    const result = linear16ToMulaw(0);
    // mulaw for 0 is ~0xff (inverted)
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(255);
  });
});
