import type { ProviderPricing } from '../types/index.js';

export const DEFAULT_PRICING: Record<string, ProviderPricing> = {
  deepgram: {
    stt: { pricePerMinute: 0.0059 },
    tts: { pricePerCharacter: 0.000015 },
  },
  openai: {
    stt: { pricePerMinute: 0.006 },
    llm: { pricePerInputToken: 0.0000025, pricePerOutputToken: 0.00001 },
    tts: { pricePerCharacter: 0.000015 },
  },
  elevenlabs: {
    tts: { pricePerCharacter: 0.000015 },
  },
  cartesia: {
    tts: { pricePerCharacter: 0.000005 },
  },
  assemblyai: {
    stt: { pricePerHour: 0.47 },
  },
  groq: {
    stt: { pricePerHour: 0.03 },
  },
  aws: {
    stt: { pricePerMinute: 0.024 },
    tts: { pricePerCharacter: 0.000004 },
  },
  google: {
    stt: { pricePerMinute: 0.016 },
    tts: { pricePerCharacter: 0.000016 },
  },
  azure: {
    stt: { pricePerHour: 1.0 },
    tts: { pricePerCharacter: 0.000015 },
  },
  sonantic: {
    tts: { pricePerCharacter: 0.00003 },
  },
  resemble: {
    tts: { pricePerCharacter: 0.00002 },
  },
  playht: {
    tts: { pricePerCharacter: 0.000025 },
  },
};
