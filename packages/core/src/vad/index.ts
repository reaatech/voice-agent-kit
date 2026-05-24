import type { VADConfig } from '../types/index.js';
import type { EnergyVADConfig } from './energy-vad.js';
import { EnergyVADProvider } from './energy-vad.js';
import type { VADProvider } from './interface.js';

export type { EnergyVADConfig } from './energy-vad.js';
export { EnergyVADProvider } from './energy-vad.js';
export type { EndpointResult, VADProvider, VADResult } from './interface.js';
export { createSemanticEndpointDetector, SemanticEndpointDetector } from './semantic-endpoint.js';

export function createVADProvider(config?: VADConfig): VADProvider {
  if (!config || config.provider === 'none') {
    return new NoopVADProvider();
  }

  const energyConfig: EnergyVADConfig = {
    sampleRate: 8000,
    speechThreshold: config.energyThreshold ?? 2.0,
    silenceTimeout: config.silenceTimeoutMs ?? 500,
    minSpeechDuration: config.minSpeechDurationMs ?? 300,
    maxSpeechDuration: config.maxSpeechDurationMs ?? 10000,
  };

  if (config.provider === 'energy') {
    return new EnergyVADProvider(energyConfig);
  }

  return new NoopVADProvider();
}

export function createDefaultVADProvider(): VADProvider {
  return new EnergyVADProvider({
    sampleRate: 8000,
    speechThreshold: 2.0,
    silenceTimeout: 500,
    minSpeechDuration: 300,
    maxSpeechDuration: 10000,
  });
}

class NoopVADProvider implements VADProvider {
  readonly name = 'none';
  readonly sampleRate = 8000;

  process(): { isSpeech: boolean; confidence: number; timestamp: number; audioLevel: number } {
    return { isSpeech: false, confidence: 0, timestamp: Date.now(), audioLevel: 0 };
  }

  checkEndpoint(): { isEndpoint: boolean; reason: 'silence'; confidence: number } {
    return { isEndpoint: false, reason: 'silence', confidence: 0 };
  }

  reset(): void {}
}
