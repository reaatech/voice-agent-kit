import type { AudioChunk } from '../types/index.js';
import type { EndpointResult, VADProvider, VADResult } from './interface.js';

export interface EnergyVADConfig {
  sampleRate?: number;
  frameSizeMs?: number;
  speechThreshold?: number;
  silenceTimeout?: number;
  minSpeechDuration?: number;
  maxSpeechDuration?: number;
  noiseFloorWindow?: number;
  smoothingFactor?: number;
}

const DEFAULT_SAMPLE_RATE = 8000;
const DEFAULT_FRAME_SIZE_MS = 20;
const DEFAULT_SPEECH_THRESHOLD = 2.0;
const DEFAULT_SILENCE_TIMEOUT = 500;
const DEFAULT_MIN_SPEECH_DURATION = 300;
const DEFAULT_MAX_SPEECH_DURATION = 10000;
const DEFAULT_NOISE_FLOOR_WINDOW = 2000;
const DEFAULT_SMOOTHING_FACTOR = 0.9;

interface SpeechSegment {
  startTime: number;
  endTime?: number;
  samples: number[];
}

export class EnergyVADProvider implements VADProvider {
  readonly name = 'energy-vad' as const;
  readonly sampleRate: number;

  private readonly frameSizeSamples: number;
  private readonly speechThreshold: number;
  private readonly silenceTimeout: number;
  private readonly minSpeechDuration: number;
  private readonly maxSpeechDuration: number;
  private readonly noiseFloorWindowSamples: number;
  private readonly smoothingFactor: number;

  private noiseFloorRms = 0;
  private noiseFloorInitialized = false;
  private readonly noiseFloorRing: number[] = [];

  private smoothedRms = 0;
  private currentSegment: SpeechSegment | null = null;
  private segments: SpeechSegment[] = [];
  private isSpeaking = false;
  private speakingStartedAt = 0;
  private lastSpeechTimestamp = 0;

  private speechHistory: VADResult[] = [];
  private readonly maxSpeechHistory = 500;

  constructor(config: EnergyVADConfig = {}) {
    this.sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.frameSizeSamples = Math.floor(
      (this.sampleRate / 1000) * (config.frameSizeMs ?? DEFAULT_FRAME_SIZE_MS),
    );
    this.speechThreshold = config.speechThreshold ?? DEFAULT_SPEECH_THRESHOLD;
    this.silenceTimeout = config.silenceTimeout ?? DEFAULT_SILENCE_TIMEOUT;
    this.minSpeechDuration = config.minSpeechDuration ?? DEFAULT_MIN_SPEECH_DURATION;
    this.maxSpeechDuration = config.maxSpeechDuration ?? DEFAULT_MAX_SPEECH_DURATION;
    this.smoothingFactor = config.smoothingFactor ?? DEFAULT_SMOOTHING_FACTOR;
    this.noiseFloorWindowSamples = Math.floor(
      this.sampleRate * ((config.noiseFloorWindow ?? DEFAULT_NOISE_FLOOR_WINDOW) / 1000),
    );
  }

  process(chunk: AudioChunk): VADResult {
    const now = chunk.timestamp || Date.now();
    const rms = this.calculateRMS(chunk.buffer);

    this.updateNoiseFloor(rms);

    const relativeRms = this.noiseFloorRms > 0 ? rms / this.noiseFloorRms : rms;

    this.smoothedRms =
      this.smoothingFactor * this.smoothedRms + (1 - this.smoothingFactor) * relativeRms;

    const isSpeech = this.smoothedRms >= this.speechThreshold && this.noiseFloorInitialized;
    const audioLevel = this.computeAudioLevel(rms);

    const result: VADResult = {
      isSpeech,
      confidence: this.computeConfidence(this.smoothedRms),
      timestamp: now,
      audioLevel,
    };

    this.updateSpeechState(result);
    this.speechHistory.push(result);
    if (this.speechHistory.length > this.maxSpeechHistory) {
      this.speechHistory.shift();
    }

    return result;
  }

  checkEndpoint(speechHistory: VADResult[]): EndpointResult {
    const history = speechHistory.length > 0 ? speechHistory : this.speechHistory;

    if (history.length === 0) {
      return {
        isEndpoint: false,
        reason: 'silence',
        confidence: 1.0,
      };
    }

    const lastResult = history[history.length - 1];
    const now = lastResult.timestamp;

    if (this.isSpeaking) {
      const totalSpeechDurationMs = now - this.speakingStartedAt;

      if (totalSpeechDurationMs >= this.maxSpeechDuration) {
        return {
          isEndpoint: true,
          reason: 'max_duration',
          totalSpeechDurationMs,
          confidence: 1.0,
        };
      }
    }

    if (this.isSpeaking) {
      const silenceDurationMs = now - this.lastSpeechTimestamp;

      if (silenceDurationMs >= this.silenceTimeout) {
        const totalSpeechDurationMs = now - this.speakingStartedAt;

        if (totalSpeechDurationMs < this.minSpeechDuration) {
          return {
            isEndpoint: false,
            reason: 'silence',
            silenceDurationMs,
            totalSpeechDurationMs,
            confidence: 0.5,
          };
        }

        return {
          isEndpoint: true,
          reason: 'silence',
          silenceDurationMs,
          totalSpeechDurationMs,
          confidence: this.computeEndpointConfidence(silenceDurationMs, totalSpeechDurationMs),
        };
      }
    }

    let totalSpeechDurationMs = 0;
    for (const seg of this.segments) {
      if (seg.endTime) {
        totalSpeechDurationMs += seg.endTime - seg.startTime;
      }
    }
    if (this.currentSegment) {
      totalSpeechDurationMs += now - this.currentSegment.startTime;
    }

    return {
      isEndpoint: false,
      reason: 'silence',
      silenceDurationMs: this.isSpeaking ? now - this.lastSpeechTimestamp : undefined,
      totalSpeechDurationMs,
      confidence: 0.0,
    };
  }

  reset(): void {
    this.noiseFloorRms = 0;
    this.noiseFloorInitialized = false;
    this.noiseFloorRing.length = 0;
    this.smoothedRms = 0;
    this.currentSegment = null;
    this.segments = [];
    this.isSpeaking = false;
    this.speakingStartedAt = 0;
    this.lastSpeechTimestamp = 0;
    this.speechHistory = [];
  }

  private calculateRMS(buffer: Buffer): number {
    let samples: number[];

    if (buffer.length === this.frameSizeSamples) {
      samples = Array.from(buffer);
    } else {
      samples = [];
      const step = Math.max(1, Math.floor(buffer.length / this.frameSizeSamples));
      for (let i = 0; i < buffer.length && samples.length < this.frameSizeSamples; i += step) {
        samples.push(buffer[i]);
      }
    }

    if (samples.length === 0) return 0;

    let sumSq = 0;
    for (const s of samples) {
      const centered = s - 128;
      sumSq += centered * centered;
    }

    return Math.sqrt(sumSq / samples.length);
  }

  private updateNoiseFloor(rms: number): void {
    if (!this.isSpeaking) {
      this.noiseFloorRing.push(rms);

      while (this.noiseFloorRing.length > this.noiseFloorWindowSamples) {
        this.noiseFloorRing.shift();
      }

      if (this.noiseFloorRing.length >= 10) {
        const avg =
          this.noiseFloorRing.reduce((sum, val) => sum + val, 0) / this.noiseFloorRing.length;

        if (!this.noiseFloorInitialized) {
          this.noiseFloorRms = avg;
          this.noiseFloorInitialized = true;
        } else {
          this.noiseFloorRms = 0.95 * this.noiseFloorRms + 0.05 * avg;
        }

        if (this.noiseFloorRms < 0.1) {
          this.noiseFloorRms = 0.1;
        }
      }
    }
  }

  private updateSpeechState(result: VADResult): void {
    if (result.isSpeech) {
      this.lastSpeechTimestamp = result.timestamp;

      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speakingStartedAt = result.timestamp;
        this.currentSegment = {
          startTime: result.timestamp,
          samples: [],
        };
      }

      if (this.currentSegment) {
        this.currentSegment.samples.push(result.audioLevel ?? 0);
      }
    } else if (this.isSpeaking) {
      const silenceDuration = result.timestamp - this.lastSpeechTimestamp;

      if (silenceDuration >= this.silenceTimeout) {
        this.finalizeCurrentSegment(result.timestamp);
      }
    }
  }

  private finalizeCurrentSegment(endTime: number): void {
    if (this.currentSegment) {
      this.currentSegment.endTime = endTime;
      this.segments.push(this.currentSegment);
      this.currentSegment = null;
    }
    this.isSpeaking = false;
    this.speakingStartedAt = 0;
  }

  private computeConfidence(relativeRms: number): number {
    const logRatio = Math.log2(Math.max(1, relativeRms));
    const clamped = Math.min(logRatio / 4, 1.0);
    return Math.max(0, Math.min(1.0, clamped));
  }

  private computeEndpointConfidence(
    silenceDurationMs: number,
    totalSpeechDurationMs: number,
  ): number {
    let confidence = 0.6;

    const ratio = silenceDurationMs / this.silenceTimeout;
    if (ratio >= 2.0) {
      confidence += 0.3;
    } else if (ratio >= 1.5) {
      confidence += 0.2;
    } else if (ratio >= 1.0) {
      confidence += 0.1;
    }

    if (totalSpeechDurationMs > 500) {
      confidence += 0.1;
    }

    return Math.min(1.0, confidence);
  }

  private computeAudioLevel(rms: number): number {
    const db = 20 * Math.log10(Math.max(rms, 0.001));
    return Math.max(0, Math.min(1.0, (db + 60) / 60));
  }
}
