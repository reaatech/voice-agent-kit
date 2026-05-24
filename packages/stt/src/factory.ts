import { AssemblyAIProvider } from './adapters/assemblyai.js';
import { AWSTranscribeProvider } from './adapters/aws-transcribe.js';
import { DeepgramSTTProvider } from './adapters/deepgram.js';
import { GoogleCloudSTTProvider } from './adapters/google-cloud-stt.js';
import { GroqWhisperSTTProvider } from './adapters/groq-whisper.js';
import { OpenAIRealtimeSTTProvider } from './adapters/openai-realtime.js';
import { OpenAIWhisperSTTProvider } from './adapters/openai-whisper.js';
import type {
  AssemblyAIConfig,
  AWSTranscribeConfig,
  DeepgramConfig,
  GoogleCloudSTTConfig,
  GroqWhisperConfig,
  OpenAIRealtimeConfig,
  OpenAIWhisperConfig,
  STTProvider,
} from './interface.js';

export type STTProviderName =
  | 'deepgram'
  | 'aws-transcribe'
  | 'google-cloud-stt'
  | 'openai-realtime'
  | 'openai-whisper'
  | 'assemblyai'
  | 'groq-whisper';

export type STTProviderConfig =
  | DeepgramConfig
  | AWSTranscribeConfig
  | GoogleCloudSTTConfig
  | OpenAIRealtimeConfig
  | OpenAIWhisperConfig
  | AssemblyAIConfig
  | GroqWhisperConfig;

export interface STTProviderFactoryConfig {
  provider: STTProviderName;
  config: STTProviderConfig;
}

export function createSTTProvider(config: STTProviderFactoryConfig): STTProvider {
  switch (config.provider) {
    case 'deepgram':
      return new DeepgramSTTProvider();
    case 'aws-transcribe':
      return new AWSTranscribeProvider();
    case 'google-cloud-stt':
      return new GoogleCloudSTTProvider();
    case 'openai-realtime':
      return new OpenAIRealtimeSTTProvider();
    case 'openai-whisper':
      return new OpenAIWhisperSTTProvider();
    case 'assemblyai':
      return new AssemblyAIProvider();
    case 'groq-whisper':
      return new GroqWhisperSTTProvider();
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown STT provider: ${_exhaustive}`);
    }
  }
}
