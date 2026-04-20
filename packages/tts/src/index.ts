/**
 * @voice-agent-kit/tts
 *
 * Text-to-speech provider interface and adapters for voice AI agents.
 */

// Provider interface
export { TTSProviderInterface } from './interface.js';
export type { TTSProvider, DeepgramTTSConfig, AWSPollyConfig, GoogleCloudTTSConfig } from './interface.js';

// Deepgram adapter
export { DeepgramTTSProvider, createDeepgramTTSProvider } from './adapters/deepgram.js';
export type { DeepgramTTSOptions } from './adapters/deepgram.js';

// AWS Polly adapter
export { AWSPollyProvider, createAWSPollyProvider } from './adapters/aws-polly.js';
export type { AWSPollyOptions } from './adapters/aws-polly.js';

// Google Cloud TTS adapter
export { GoogleCloudTTSProvider, createGoogleCloudTTSProvider } from './adapters/google-cloud-tts.js';
export type { GoogleCloudTTSOptions } from './adapters/google-cloud-tts.js';

// Factory
export { createTTSProvider } from './factory.js';
export type { TTSProviderFactoryConfig } from './factory.js';
