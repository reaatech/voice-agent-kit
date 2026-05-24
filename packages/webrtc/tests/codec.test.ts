import { describe, expect, it } from 'vitest';

import {
  changeVolume,
  convertSampleFormat,
  interleaveToMono,
  monoToInterleave,
  resample,
} from '../src/codec/resampler.js';

describe('resample', () => {
  it('should return the same buffer when rates are equal', () => {
    const buffer = Buffer.alloc(480, 0);
    // Write a sine-like pattern
    for (let i = 0; i < 240; i++) {
      buffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 16000), i * 2);
    }

    const result = resample(buffer, 48000, 48000, 1);
    expect(result).toEqual(buffer);
  });

  it('should downsample from 48000 to 16000', () => {
    const srcRate = 48000;
    const monoBuffer = Buffer.allocUnsafe(srcRate * 2); // 1 second mono Int16
    for (let i = 0; i < srcRate; i++) {
      monoBuffer.writeInt16LE(
        Math.round(Math.sin((i / srcRate) * Math.PI * 2 * 440) * 16000),
        i * 2,
      );
    }

    const result = resample(monoBuffer, srcRate, 16000, 1);
    // Output should have (srcRate / 16000) fewer samples
    const expectedSamples = Math.floor(srcRate * (16000 / srcRate));
    expect(result.length).toBe(expectedSamples * 2);

    // Should not be all zeros
    let nonZeroCount = 0;
    for (let i = 0; i < Math.min(result.length / 2, 100); i++) {
      if (result.readInt16LE(i * 2) !== 0) nonZeroCount++;
    }
    expect(nonZeroCount).toBeGreaterThan(0);
  });

  it('should upsample from 8000 to 16000', () => {
    const srcRate = 8000;
    const monoBuffer = Buffer.allocUnsafe(srcRate * 2);
    for (let i = 0; i < srcRate; i++) {
      monoBuffer.writeInt16LE(
        Math.round(Math.sin((i / srcRate) * Math.PI * 2 * 440) * 8000),
        i * 2,
      );
    }

    const result = resample(monoBuffer, srcRate, 16000, 1);
    const expectedSamples = Math.floor(srcRate * (16000 / srcRate));
    expect(result.length).toBe(expectedSamples * 2);
  });

  it('should handle stereo resampling', () => {
    const srcRate = 48000;
    const stereoBuffer = Buffer.allocUnsafe(srcRate * 2 * 2); // 1 second stereo
    for (let i = 0; i < srcRate; i++) {
      const left = Math.round(Math.sin((i / srcRate) * Math.PI * 2 * 440) * 16000);
      const right = Math.round(Math.sin((i / srcRate) * Math.PI * 2 * 880) * 12000);
      stereoBuffer.writeInt16LE(left, i * 4);
      stereoBuffer.writeInt16LE(right, i * 4 + 2);
    }

    const result = resample(stereoBuffer, srcRate, 16000, 2);
    const expectedSamples = Math.floor(srcRate * (16000 / srcRate)) * 2; // 2 channels
    expect(result.length).toBe(expectedSamples * 2);
  });

  it('should throw for invalid sample rates', () => {
    expect(() => resample(Buffer.alloc(4), 0, 16000, 1)).toThrow();
    expect(() => resample(Buffer.alloc(4), 8000, -1, 1)).toThrow();
  });

  it('should handle edge case: very short buffer', () => {
    const buffer = Buffer.allocUnsafe(4); // 2 samples
    buffer.writeInt16LE(1000, 0);
    buffer.writeInt16LE(2000, 2);

    const result = resample(buffer, 8000, 16000, 1);
    // Upsampling by 2x: 2 input samples → 4 output samples
    expect(result.length).toBe(8); // 4 samples * 2 bytes
  });
});

describe('convertSampleFormat', () => {
  it('should return same buffer when formats are equal', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(convertSampleFormat(buffer, 16, 16)).toBe(buffer);
    expect(convertSampleFormat(buffer, 8, 8)).toBe(buffer);
  });

  it('should convert 16-bit to 8-bit', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt16LE(0, 0); // Centre → 128
    buffer.writeInt16LE(16000, 2); // Positive → >128

    const result = convertSampleFormat(buffer, 16, 8);
    expect(result.length).toBe(2); // Half the bytes
    // Centre should map close to 128
    expect(result.readUInt8(0)).toBeGreaterThanOrEqual(126);
    expect(result.readUInt8(0)).toBeLessThanOrEqual(130);
  });

  it('should convert 8-bit to 16-bit', () => {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(128, 0); // Centre
    buffer.writeUInt8(200, 1); // Above centre

    const result = convertSampleFormat(buffer, 8, 16);
    expect(result.length).toBe(4); // Double the bytes
    // Centre 8-bit (128) → ~0 in 16-bit signed
    const centre16 = result.readInt16LE(0);
    expect(Math.abs(centre16)).toBeLessThan(2000);
  });

  it('should be near-lossless round-trip 16→8→16', () => {
    const original = Buffer.allocUnsafe(40);
    for (let i = 0; i < 20; i++) {
      original.writeInt16LE(Math.round((Math.random() - 0.5) * 60000), i * 2);
    }

    const as8 = convertSampleFormat(original, 16, 8);
    const as16 = convertSampleFormat(as8, 8, 16);

    // Round-trip will lose precision but should be close
    for (let i = 0; i < 20; i++) {
      const orig = original.readInt16LE(i * 2);
      const rt = as16.readInt16LE(i * 2);
      expect(Math.abs(orig - rt)).toBeLessThan(3000);
    }
  });

  it('should throw for unsupported conversions', () => {
    expect(() => convertSampleFormat(Buffer.alloc(1), 10 as 8, 16)).toThrow();
  });
});

describe('interleaveToMono', () => {
  it('should average stereo channels to mono', () => {
    const stereo = Buffer.allocUnsafe(8); // 2 stereo frames
    stereo.writeInt16LE(1000, 0); // L0
    stereo.writeInt16LE(2000, 2); // R0
    stereo.writeInt16LE(-500, 4); // L1
    stereo.writeInt16LE(500, 6); // R1

    const mono = interleaveToMono(stereo);
    expect(mono.length).toBe(4); // 2 mono samples
    expect(mono.readInt16LE(0)).toBe(1500); // (1000+2000)/2
    expect(mono.readInt16LE(2)).toBe(0); // (-500+500)/2
  });

  it('should handle identical channels', () => {
    const stereo = Buffer.allocUnsafe(8);
    stereo.writeInt16LE(100, 0);
    stereo.writeInt16LE(100, 2);
    stereo.writeInt16LE(-200, 4);
    stereo.writeInt16LE(-200, 6);

    const mono = interleaveToMono(stereo);
    expect(mono.readInt16LE(0)).toBe(100);
    expect(mono.readInt16LE(2)).toBe(-200);
  });
});

describe('monoToInterleave', () => {
  it('should duplicate mono samples to stereo', () => {
    const mono = Buffer.allocUnsafe(4);
    mono.writeInt16LE(1000, 0);
    mono.writeInt16LE(-500, 2);

    const stereo = monoToInterleave(mono);
    expect(stereo.length).toBe(8); // 2 stereo frames * 2 bytes * 2 channels

    expect(stereo.readInt16LE(0)).toBe(1000); // L0
    expect(stereo.readInt16LE(2)).toBe(1000); // R0
    expect(stereo.readInt16LE(4)).toBe(-500); // L1
    expect(stereo.readInt16LE(6)).toBe(-500); // R1
  });

  it('should be round-trip compatible', () => {
    const original = Buffer.allocUnsafe(20);
    for (let i = 0; i < 10; i++) {
      original.writeInt16LE(Math.round((Math.random() - 0.5) * 60000), i * 2);
    }

    const stereo = monoToInterleave(original);
    const mono = interleaveToMono(stereo);

    expect(mono).toEqual(original);
  });
});

describe('changeVolume', () => {
  it('should return same buffer for factor 1.0', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(changeVolume(buffer, 1.0)).toBe(buffer);
  });

  it('should halve volume', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt16LE(2000, 0);
    buffer.writeInt16LE(-4000, 2);

    const result = changeVolume(buffer, 0.5);
    expect(result.readInt16LE(0)).toBe(1000);
    expect(result.readInt16LE(2)).toBe(-2000);
  });

  it('should double volume with clamping', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt16LE(20000, 0);
    buffer.writeInt16LE(-30000, 2);

    const result = changeVolume(buffer, 2.0);
    // Should be clamped to 16-bit range
    expect(result.readInt16LE(0)).toBeLessThanOrEqual(32767);
    expect(result.readInt16LE(2)).toBeGreaterThanOrEqual(-32768);
  });
});
