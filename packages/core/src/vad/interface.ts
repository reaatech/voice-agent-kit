import type { AudioChunk } from '../types/index.js';

export interface VADResult {
  isSpeech: boolean;
  confidence: number;
  timestamp: number;
  audioLevel?: number;
}

export interface EndpointResult {
  isEndpoint: boolean;
  reason: 'silence' | 'max_duration' | 'interrupt' | 'semantic';
  silenceDurationMs?: number;
  totalSpeechDurationMs?: number;
  confidence: number;
}

export interface VADProvider {
  readonly name: string;
  readonly sampleRate: number;

  process(chunk: AudioChunk): VADResult;

  checkEndpoint(speechHistory: VADResult[]): EndpointResult;

  reset(): void;
}
