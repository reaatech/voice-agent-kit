/**
 * @reaatech/voice-agent-stt
 *
 * Speech-to-text provider interface and adapters for voice AI agents.
 */

// AssemblyAI adapter
export type { AssemblyAIOptions } from './adapters/assemblyai.js';
export { AssemblyAIProvider, createAssemblyAIProvider } from './adapters/assemblyai.js';
// AWS Transcribe adapter
export type { AWSTranscribeOptions } from './adapters/aws-transcribe.js';
export { AWSTranscribeProvider, createAWSTranscribeProvider } from './adapters/aws-transcribe.js';
// Deepgram adapter
export type { DeepgramSTTOptions } from './adapters/deepgram.js';
export { createDeepgramSTTProvider, DeepgramSTTProvider } from './adapters/deepgram.js';
// Gemini Live S2S adapter
export type { GeminiLiveS2SOptions } from './adapters/gemini-live-s2s.js';
export {
  createGeminiLiveS2SProvider,
  GeminiLiveS2SProvider,
} from './adapters/gemini-live-s2s.js';
// Google Cloud STT adapter
export type { GoogleCloudSTTOptions } from './adapters/google-cloud-stt.js';
export {
  createGoogleCloudSTTProvider,
  GoogleCloudSTTProvider,
} from './adapters/google-cloud-stt.js';
// Groq Whisper adapter
export type { GroqWhisperOptions } from './adapters/groq-whisper.js';
export {
  createGroqWhisperSTTProvider,
  GroqWhisperSTTProvider,
} from './adapters/groq-whisper.js';

// OpenAI Realtime adapter
export type { OpenAIRealtimeOptions } from './adapters/openai-realtime.js';
export {
  createOpenAIRealtimeSTTProvider,
  OpenAIRealtimeSTTProvider,
} from './adapters/openai-realtime.js';

// OpenAI Realtime S2S adapter
export type { OpenAIRealtimeS2SOptions } from './adapters/openai-realtime-s2s.js';
export {
  createOpenAIRealtimeS2SProvider,
  OpenAIRealtimeS2SProvider,
} from './adapters/openai-realtime-s2s.js';
// OpenAI Whisper adapter
export type { OpenAIWhisperOptions } from './adapters/openai-whisper.js';
export {
  createOpenAIWhisperSTTProvider,
  OpenAIWhisperSTTProvider,
} from './adapters/openai-whisper.js';

// Factory
export type { STTProviderConfig, STTProviderFactoryConfig, STTProviderName } from './factory.js';
export { createSTTProvider } from './factory.js';

// Provider interface
export type {
  AssemblyAIConfig,
  AWSTranscribeConfig,
  DeepgramConfig,
  GoogleCloudSTTConfig,
  GroqWhisperConfig,
  OpenAIRealtimeConfig,
  OpenAIWhisperConfig,
  STTConfigUnion,
  STTProvider,
  STTProviderEvents,
} from './interface.js';
export { STTProviderInterface } from './interface.js';
