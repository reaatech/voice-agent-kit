import { AWSPollyProvider } from './adapters/aws-polly.js';
import { CartesiaTTSProvider } from './adapters/cartesia.js';
import { DeepgramTTSProvider } from './adapters/deepgram.js';
import { ElevenLabsTTSProvider } from './adapters/elevenlabs.js';
import { GoogleCloudTTSProvider } from './adapters/google-cloud-tts.js';
import type {
  AWSPollyConfig,
  CartesiaConfig,
  DeepgramTTSConfig,
  ElevenLabsConfig,
  GoogleCloudTTSConfig,
  TTSProvider,
} from './interface.js';

export interface TTSProviderFactoryConfig {
  provider: 'deepgram' | 'aws-polly' | 'google-cloud-tts' | 'elevenlabs' | 'cartesia';
  config:
    | DeepgramTTSConfig
    | AWSPollyConfig
    | GoogleCloudTTSConfig
    | ElevenLabsConfig
    | CartesiaConfig;
}

export function createTTSProvider(config: TTSProviderFactoryConfig): TTSProvider {
  switch (config.provider) {
    case 'deepgram':
      return new DeepgramTTSProvider();
    case 'aws-polly':
      return new AWSPollyProvider();
    case 'google-cloud-tts':
      return new GoogleCloudTTSProvider();
    case 'elevenlabs':
      return new ElevenLabsTTSProvider();
    case 'cartesia':
      return new CartesiaTTSProvider();
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}
