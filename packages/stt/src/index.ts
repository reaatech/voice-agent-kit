/**
 * @voice-agent-kit/stt
 *
 * Speech-to-text provider interface and adapters for voice AI agents.
 */

// Provider interface
export { STTProviderInterface } from './interface.js';
export type {
  STTProvider,
  STTProviderEvents,
  DeepgramConfig,
  AWSTranscribeConfig,
  GoogleCloudSTTConfig,
} from './interface.js';

// Deepgram adapter
export { DeepgramSTTProvider, createDeepgramSTTProvider } from './adapters/deepgram.js';
export type { DeepgramSTTOptions } from './adapters/deepgram.js';

// AWS Transcribe adapter
export { AWSTranscribeProvider, createAWSTranscribeProvider } from './adapters/aws-transcribe.js';
export type { AWSTranscribeOptions } from './adapters/aws-transcribe.js';

// Google Cloud STT adapter
export {
  GoogleCloudSTTProvider,
  createGoogleCloudSTTProvider,
} from './adapters/google-cloud-stt.js';
export type { GoogleCloudSTTOptions } from './adapters/google-cloud-stt.js';

// Factory
export { createSTTProvider } from './factory.js';
export type { STTProviderFactoryConfig } from './factory.js';
