/**
 * Audio resampling utilities for converting between sample rates and channel layouts.
 *
 * All operations work on raw PCM Int16 buffers. Input and output buffers are
 * separate — no in-place mutation.
 */

/**
 * Resample a PCM Int16 buffer from one sample rate to another using
 * linear interpolation. Supports mono and stereo (stereo channels are
 * resampled independently).
 *
 * @param buffer - Source PCM Int16 buffer (interleaved for stereo).
 * @param fromRate - Original sample rate in Hz.
 * @param toRate - Target sample rate in Hz.
 * @param channels - Number of channels (1 = mono, 2 = stereo).
 */
export function resample(
  buffer: Buffer,
  fromRate: number,
  toRate: number,
  channels: number,
): Buffer {
  if (fromRate === toRate) {
    return buffer;
  }

  if (fromRate <= 0 || toRate <= 0) {
    throw new Error(`Invalid sample rates: fromRate=${fromRate}, toRate=${toRate}`);
  }

  const ratio = fromRate / toRate;
  const sampleCount = Math.floor(buffer.length / 2); // Int16 = 2 bytes per sample
  const frameCount = Math.floor(sampleCount / channels);
  const outputFrames = Math.floor(frameCount / ratio);
  const outputSamples = outputFrames * channels;
  const outputBuffer = Buffer.allocUnsafe(outputSamples * 2);

  for (let outFrame = 0; outFrame < outputFrames; outFrame++) {
    const srcPosition = outFrame * ratio;
    const srcIndex = Math.floor(srcPosition);
    const fraction = srcPosition - srcIndex;

    for (let ch = 0; ch < channels; ch++) {
      const i0 = (srcIndex * channels + ch) * 2;
      const i1 = ((srcIndex + 1) * channels + ch) * 2;

      if (i1 >= buffer.length) {
        // Past the end — duplicate last sample
        buffer.copy(outputBuffer, (outFrame * channels + ch) * 2, i0, i0 + 2);
        continue;
      }

      const s0 = buffer.readInt16LE(i0);
      const s1 = buffer.readInt16LE(i1);
      const interpolated = Math.round(s0 + (s1 - s0) * fraction);
      const clamped = Math.max(-32768, Math.min(32767, interpolated));

      outputBuffer.writeInt16LE(clamped, (outFrame * channels + ch) * 2);
    }
  }

  return outputBuffer;
}

/**
 * Convert between 8-bit unsigned PCM and 16-bit signed PCM.
 *
 * 8-bit unsigned uses range 0–255 with centre at 128.
 * 16-bit signed uses range −32768–32767 with centre at 0.
 *
 * @param buffer - Source PCM buffer.
 * @param fromBits - Bit depth of source (8 or 16).
 * @param toBits - Bit depth of target (8 or 16).
 */
export function convertSampleFormat(buffer: Buffer, fromBits: 8 | 16, toBits: 8 | 16): Buffer {
  if (fromBits === toBits) {
    return buffer;
  }

  if (fromBits === 16 && toBits === 8) {
    return int16ToInt8(buffer);
  }

  if (fromBits === 8 && toBits === 16) {
    return int8ToInt16(buffer);
  }

  throw new Error(`Unsupported bit-depth conversion: ${fromBits} → ${toBits}`);
}

/**
 * Convert 16-bit signed PCM to 8-bit unsigned PCM.
 */
function int16ToInt8(buffer: Buffer): Buffer {
  const sampleCount = Math.floor(buffer.length / 2);
  const output = Buffer.allocUnsafe(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const s16 = buffer.readInt16LE(i * 2);
    // 16-bit signed [-32768, 32767] → 8-bit unsigned [0, 255]
    const s8 = Math.max(0, Math.min(255, Math.round((s16 / 32768) * 127 + 128)));
    output.writeUInt8(s8, i);
  }

  return output;
}

/**
 * Convert 8-bit unsigned PCM to 16-bit signed PCM.
 */
function int8ToInt16(buffer: Buffer): Buffer {
  const output = Buffer.allocUnsafe(buffer.length * 2);

  for (let i = 0; i < buffer.length; i++) {
    const s8 = buffer.readUInt8(i);
    // 8-bit unsigned [0, 255] → 16-bit signed [-32768, 32767]
    const s16 = Math.max(-32768, Math.min(32767, Math.round(((s8 - 128) / 127) * 32768)));
    output.writeInt16LE(s16, i * 2);
  }

  return output;
}

/**
 * Convert a stereo Int16 PCM buffer to mono by averaging the channels.
 *
 * Input: [L0, R0, L1, R1, ...]  (interleaved Int16)
 * Output: [M0, M1, ...]          (mono Int16)
 *
 * @param stereoBuffer - Interleaved stereo Int16 PCM buffer.
 */
export function interleaveToMono(stereoBuffer: Buffer): Buffer {
  const sampleCount = Math.floor(stereoBuffer.length / 2 / 2); // 2 bytes per sample, 2 channels
  const output = Buffer.allocUnsafe(sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    const left = stereoBuffer.readInt16LE(i * 4);
    const right = stereoBuffer.readInt16LE(i * 4 + 2);
    // Average with rounding
    const mono = Math.round((left + right) / 2);
    output.writeInt16LE(mono, i * 2);
  }

  return output;
}

/**
 * Convert a mono Int16 PCM buffer to stereo by duplicating each sample.
 *
 * Input: [M0, M1, ...]           (mono Int16)
 * Output: [L0, R0, L1, R1, ...]  (interleaved Int16)
 *
 * @param monoBuffer - Mono Int16 PCM buffer.
 */
export function monoToInterleave(monoBuffer: Buffer): Buffer {
  const sampleCount = Math.floor(monoBuffer.length / 2);
  const output = Buffer.allocUnsafe(sampleCount * 4);

  for (let i = 0; i < sampleCount; i++) {
    const sample = monoBuffer.readInt16LE(i * 2);
    output.writeInt16LE(sample, i * 4); // left
    output.writeInt16LE(sample, i * 4 + 2); // right
  }

  return output;
}

/**
 * Change volume of a PCM Int16 buffer by a linear factor.
 *
 * @param buffer - PCM Int16 buffer.
 * @param factor - Volume multiplier (1.0 = no change, 0.5 = half, 2.0 = double).
 */
export function changeVolume(buffer: Buffer, factor: number): Buffer {
  if (factor === 1.0) {
    return buffer;
  }

  const output = Buffer.allocUnsafe(buffer.length);
  const sampleCount = Math.floor(buffer.length / 2);

  for (let i = 0; i < sampleCount; i++) {
    const s = buffer.readInt16LE(i * 2);
    const adjusted = Math.max(-32768, Math.min(32767, Math.round(s * factor)));
    output.writeInt16LE(adjusted, i * 2);
  }

  return output;
}
