/**
 * @reaatech/voice-agent-tts
 *
 * Text-to-speech provider interface and adapters for voice AI agents.
 */

export type { AWSPollyOptions } from './adapters/aws-polly.js';
// AWS Polly adapter
export { AWSPollyProvider, createAWSPollyProvider } from './adapters/aws-polly.js';
export type { DeepgramTTSOptions } from './adapters/deepgram.js';
// Deepgram adapter
export { createDeepgramTTSProvider, DeepgramTTSProvider } from './adapters/deepgram.js';
export type { GoogleCloudTTSOptions } from './adapters/google-cloud-tts.js';
// Google Cloud TTS adapter
export {
  createGoogleCloudTTSProvider,
  GoogleCloudTTSProvider,
} from './adapters/google-cloud-tts.js';
export type { TTSProviderFactoryConfig } from './factory.js';
// Factory
export { createTTSProvider } from './factory.js';
export type {
  AWSPollyConfig,
  DeepgramTTSConfig,
  GoogleCloudTTSConfig,
  TTSProvider,
} from './interface.js';
// Provider interface
export { TTSProviderInterface } from './interface.js';
