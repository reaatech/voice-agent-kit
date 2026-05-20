/**
 * @reaatech/voice-agent-stt
 *
 * Speech-to-text provider interface and adapters for voice AI agents.
 */

export type { AWSTranscribeOptions } from './adapters/aws-transcribe.js';
// AWS Transcribe adapter
export { AWSTranscribeProvider, createAWSTranscribeProvider } from './adapters/aws-transcribe.js';
export type { DeepgramSTTOptions } from './adapters/deepgram.js';
// Deepgram adapter
export { createDeepgramSTTProvider, DeepgramSTTProvider } from './adapters/deepgram.js';
export type { GoogleCloudSTTOptions } from './adapters/google-cloud-stt.js';
// Google Cloud STT adapter
export {
  createGoogleCloudSTTProvider,
  GoogleCloudSTTProvider,
} from './adapters/google-cloud-stt.js';
export type { STTProviderFactoryConfig } from './factory.js';
// Factory
export { createSTTProvider } from './factory.js';
export type {
  AWSTranscribeConfig,
  DeepgramConfig,
  GoogleCloudSTTConfig,
  STTProvider,
  STTProviderEvents,
} from './interface.js';
// Provider interface
export { STTProviderInterface } from './interface.js';
