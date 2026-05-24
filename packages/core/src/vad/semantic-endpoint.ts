import type { AudioChunk } from '../types/index.js';
import type { EnergyVADConfig } from './energy-vad.js';
import { EnergyVADProvider } from './energy-vad.js';
import type { EndpointResult, VADProvider, VADResult } from './interface.js';

export interface SemanticEndpointConfig {
  vadProvider: VADProvider;
  continuePatterns?: RegExp[];
  completePatterns?: RegExp[];
  minUtteranceLength?: number;
}

const DEFAULT_CONTINUE_PATTERNS: RegExp[] = [
  /\b(and|um|uh|also|plus|then|so|like|you know)\s*$/i,
  /\b(in|on|at|by|with|for|from|to|of|about)\s*$/i,
  /\b(the|a|an)\s*$/i,
  /\b(not|or|but)\s*$/i,
  /,\s*$/,
];

const DEFAULT_COMPLETE_PATTERNS: RegExp[] = [
  /[.?!]$/,
  /\b(bye|goodbye|thanks|thank you|done|okay|that'?s all|that'?s it)\s*$/i,
  /\b(please|help me|what do you)\s*$/i,
];

const DEFAULT_MIN_UTTERANCE_LENGTH = 2;

export class SemanticEndpointDetector implements VADProvider {
  readonly name = 'semantic-endpoint' as const;

  get sampleRate(): number {
    return this.innerVad.sampleRate;
  }

  private readonly innerVad: VADProvider;
  private readonly continuePatterns: RegExp[];
  private readonly completePatterns: RegExp[];
  private readonly minUtteranceLength: number;

  private lastUtteranceText = '';
  private lastUtteranceConfidence = 0;

  constructor(config: SemanticEndpointConfig) {
    this.innerVad = config.vadProvider;
    this.continuePatterns = config.continuePatterns ?? DEFAULT_CONTINUE_PATTERNS;
    this.completePatterns = config.completePatterns ?? DEFAULT_COMPLETE_PATTERNS;
    this.minUtteranceLength = config.minUtteranceLength ?? DEFAULT_MIN_UTTERANCE_LENGTH;
  }

  process(chunk: AudioChunk): VADResult {
    return this.innerVad.process(chunk);
  }

  feedUtterance(transcript: string, confidence: number): void {
    if (transcript && transcript.trim().length > 0) {
      this.lastUtteranceText = transcript.trim();
      this.lastUtteranceConfidence = confidence;
    }
  }

  checkEndpoint(speechHistory: VADResult[]): EndpointResult {
    const baseResult = this.innerVad.checkEndpoint(speechHistory);

    if (!baseResult.isEndpoint) {
      return baseResult;
    }

    const textLength = this.lastUtteranceText.split(/\s+/).filter(Boolean).length;

    if (textLength < this.minUtteranceLength && !this.hasCompletePattern(this.lastUtteranceText)) {
      return {
        isEndpoint: false,
        reason: 'silence',
        silenceDurationMs: baseResult.silenceDurationMs,
        totalSpeechDurationMs: baseResult.totalSpeechDurationMs,
        confidence: 0.3,
      };
    }

    const hasContinue = this.hasContinuePattern(this.lastUtteranceText);
    const hasComplete = this.hasCompletePattern(this.lastUtteranceText);

    if (hasContinue && !hasComplete) {
      return {
        isEndpoint: false,
        reason: 'semantic',
        silenceDurationMs: baseResult.silenceDurationMs,
        totalSpeechDurationMs: baseResult.totalSpeechDurationMs,
        confidence: 0.4,
      };
    }

    const semanticConfidence = this.computeSemanticConfidence(
      this.lastUtteranceText,
      this.lastUtteranceConfidence,
      baseResult,
    );

    return {
      isEndpoint: true,
      reason: 'semantic',
      silenceDurationMs: baseResult.silenceDurationMs,
      totalSpeechDurationMs: baseResult.totalSpeechDurationMs,
      confidence: semanticConfidence,
    };
  }

  reset(): void {
    this.innerVad.reset();
    this.lastUtteranceText = '';
    this.lastUtteranceConfidence = 0;
  }

  private hasContinuePattern(text: string): boolean {
    for (const pattern of this.continuePatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  private hasCompletePattern(text: string): boolean {
    for (const pattern of this.completePatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  private computeSemanticConfidence(
    text: string,
    confidence: number,
    baseResult: EndpointResult,
  ): number {
    let score = baseResult.confidence;

    if (this.hasCompletePattern(text)) {
      score += 0.2;
    }

    const questionMarks = (text.match(/\?/g) || []).length;
    score += questionMarks * 0.1;

    if (text.length > 20) {
      score += 0.1;
    }

    score += confidence * 0.1;

    return Math.min(1.0, score);
  }
}

export function createSemanticEndpointDetector(
  energyConfig?: EnergyVADConfig,
  semanticConfig?: Omit<SemanticEndpointConfig, 'vadProvider'>,
): SemanticEndpointDetector {
  const energyVad = new EnergyVADProvider(energyConfig);
  return new SemanticEndpointDetector({
    vadProvider: energyVad,
    ...semanticConfig,
  });
}
