import { AWSPollyProvider } from './adapters/aws-polly.js';
import { DeepgramTTSProvider } from './adapters/deepgram.js';
import { GoogleCloudTTSProvider } from './adapters/google-cloud-tts.js';
import type {
  TTSProvider,
  DeepgramTTSConfig,
  AWSPollyConfig,
  GoogleCloudTTSConfig,
} from './interface.js';

export interface TTSProviderFactoryConfig {
  provider: 'deepgram' | 'aws-polly' | 'google-cloud-tts';
  config: DeepgramTTSConfig | AWSPollyConfig | GoogleCloudTTSConfig;
}

export function createTTSProvider(config: TTSProviderFactoryConfig): TTSProvider {
  switch (config.provider) {
    case 'deepgram':
      return new DeepgramTTSProvider();
    case 'aws-polly':
      return new AWSPollyProvider();
    case 'google-cloud-tts':
      return new GoogleCloudTTSProvider();
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}
