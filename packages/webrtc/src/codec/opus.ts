import debugFactory from 'debug';
import { createRequire } from 'module';

const debug = debugFactory('voice:webrtc:codec:opus');

// Lazy-loaded Opus bindings
type OpusEncoderConstructor = new (rate: number, channels: number) => OpusEncoderNative;
type OpusDecoderConstructor = new (rate: number, channels: number) => OpusDecoderNative;

let _OpusEncoder: OpusEncoderConstructor | null = null;
let _OpusDecoder: OpusDecoderConstructor | null = null;

interface OpusEncoderNative {
  encode(buffer: Buffer, frameSize: number): Buffer;
  decode?: (buffer: Buffer, frameSize: number) => Buffer;
  applyEncoderCTL?(ctl: number, value: number): void;
}

interface OpusDecoderNative {
  decode(buffer: Buffer, frameSize: number): Buffer;
}

/**
 * Attempt to load the native Opus bindings.
 * Tries `@discordjs/opus` first, then `prism-media`.
 *
 * Returns true if a suitable codec library was loaded.
 */
function tryLoadOpusBindings(): boolean {
  if (_OpusEncoder && _OpusDecoder) {
    return true;
  }

  const localRequire = createRequire(import.meta.url);

  // Attempt 1: @discordjs/opus (native addon)
  try {
    const opus = localRequire('@discordjs/opus') as {
      OpusEncoder: new (rate: number, channels: number) => OpusEncoderNative;
      OpusDecoder: new (rate: number, channels: number) => OpusDecoderNative;
    };
    if (opus?.OpusEncoder && opus?.OpusDecoder) {
      _OpusEncoder = opus.OpusEncoder;
      _OpusDecoder = opus.OpusDecoder;
      debug('Loaded @discordjs/opus');
      return true;
    }
  } catch {
    debug('@discordjs/opus not available');
  }

  // Attempt 2: prism-media (provides OpusEncoder/OpusDecoder)
  try {
    const prism = localRequire('prism-media') as {
      opus: {
        Encoder: new (options: {
          rate: number;
          channels: number;
          frameSize: number;
        }) => OpusEncoderNative;
        Decoder: new (options: {
          rate: number;
          channels: number;
          frameSize: number;
        }) => OpusDecoderNative;
      };
      default?: unknown;
    };

    const opusModule =
      (prism as { opus: typeof prism.opus }).opus ??
      (prism as { default?: { opus: typeof prism.opus } }).default?.opus;

    if (opusModule?.Encoder && opusModule?.Decoder) {
      _OpusEncoder = opusModule.Encoder as unknown as typeof _OpusEncoder;
      _OpusDecoder = opusModule.Decoder as unknown as typeof _OpusDecoder;
      debug('Loaded prism-media Opus bindings');
      return true;
    }
  } catch {
    debug('prism-media not available');
  }

  return false;
}

/**
 * Check whether Opus codec support is available in the current environment.
 */
export function isOpusAvailable(): boolean {
  return tryLoadOpusBindings();
}

function ensureOpusLoaded(): void {
  if (!tryLoadOpusBindings()) {
    throw new Error(
      'Opus codec support is required for WebRTC transport. ' +
        'Install @discordjs/opus:  pnpm add @discordjs/opus',
    );
  }
}

/**
 * Decode an Opus-encoded buffer to PCM Int16.
 *
 * @param opusBuffer - Raw Opus packet data.
 * @param sampleRate - Sample rate the Opus was encoded at (e.g. 48000 or 16000).
 * @param channels - Number of channels (1 = mono, 2 = stereo).
 * @returns Decoded PCM Int16 buffer.
 */
export function decodeOpus(opusBuffer: Buffer, sampleRate: number, channels: number): Buffer {
  ensureOpusLoaded();

  const Decoder = _OpusDecoder;
  if (!Decoder) throw new Error('Opus decoder not loaded');
  const decoder = new Decoder(sampleRate, channels);

  try {
    // Opus frame size is typically 20ms: sampleRate * 0.02
    const frameSize = Math.floor(sampleRate * 0.02);
    const result = decoder.decode(opusBuffer, frameSize);

    if (!result || result.length === 0) {
      debug(
        'Opus decode produced empty buffer for %d bytes at %dHz/%dch',
        opusBuffer.length,
        sampleRate,
        channels,
      );
      return Buffer.alloc(0);
    }

    return result;
  } finally {
    // Clean up native resources
    try {
      (decoder as unknown as { delete?: () => void }).delete?.();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Encode a PCM Int16 buffer to Opus.
 *
 * @param pcmBuffer - Raw PCM Int16 data.
 * @param sampleRate - Sample rate of the PCM data (e.g. 16000 or 48000).
 * @param channels - Number of channels (1 = mono, 2 = stereo).
 * @returns Opus-encoded buffer.
 */
export function encodeOpus(pcmBuffer: Buffer, sampleRate: number, channels: number): Buffer {
  ensureOpusLoaded();

  const Encoder = _OpusEncoder;
  if (!Encoder) throw new Error('Opus encoder not loaded');
  const encoder = new Encoder(sampleRate, channels);

  try {
    // Optionally set to voice-optimised mode (OPUS_APPLICATION_VOIP = 2048)
    try {
      encoder.applyEncoderCTL?.(4008, 2048);
    } catch {
      // CTL may not be available on all bindings
    }

    // Opus frame size: 20ms is standard
    const frameSize = Math.floor(sampleRate * 0.02);
    return encoder.encode(pcmBuffer, frameSize);
  } finally {
    try {
      (encoder as unknown as { delete?: () => void }).delete?.();
    } catch {
      // best-effort cleanup
    }
  }
}
