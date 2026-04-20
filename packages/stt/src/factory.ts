import { AWSTranscribeProvider } from './adapters/aws-transcribe.js';
import { DeepgramSTTProvider } from './adapters/deepgram.js';
import { GoogleCloudSTTProvider } from './adapters/google-cloud-stt.js';
import type {
  STTProvider,
  DeepgramConfig,
  AWSTranscribeConfig,
  GoogleCloudSTTConfig,
} from './interface.js';

export interface STTProviderFactoryConfig {
  provider: 'deepgram' | 'aws-transcribe' | 'google-cloud-stt';
  config: DeepgramConfig | AWSTranscribeConfig | GoogleCloudSTTConfig;
}

export function createSTTProvider(config: STTProviderFactoryConfig): STTProvider {
  switch (config.provider) {
    case 'deepgram':
      return new DeepgramSTTProvider();
    case 'aws-transcribe':
      return new AWSTranscribeProvider();
    case 'google-cloud-stt':
      return new GoogleCloudSTTProvider();
    default:
      throw new Error(`Unknown STT provider: ${config.provider}`);
  }
}
