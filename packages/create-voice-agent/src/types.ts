export interface ProjectOptions {
  projectName: string;
  sttProvider: SttProvider;
  ttsProvider: TtsProvider;
  telephony: TelephonyProvider;
  transport: TransportType;
  mcpEndpoint: string;
  apiKeys: ApiKeys;
  skipInstall: boolean;
  quickMode: boolean;
}

export type SttProvider =
  | 'deepgram'
  | 'openai-realtime'
  | 'openai-whisper'
  | 'assemblyai'
  | 'groq-whisper'
  | 'aws-transcribe'
  | 'google-cloud-stt'
  | 'mock';

export type TtsProvider =
  | 'deepgram'
  | 'elevenlabs'
  | 'cartesia'
  | 'aws-polly'
  | 'google-cloud-tts'
  | 'mock';

export type TelephonyProvider = 'twilio' | 'telnyx' | 'none';

export type TransportType = 'twilio' | 'webrtc';

export interface ApiKeys {
  DEEPGRAM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ASSEMBLYAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  ELEVENLABS_API_KEY?: string;
  CARTESIA_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  TELNYX_API_KEY?: string;
  TELNYX_SIP_DOMAIN?: string;
  MCP_API_KEY?: string;
}

export interface SttProviderConfig {
  keys: (keyof ApiKeys)[];
  defaults: Record<string, unknown>;
}

export interface TtsProviderConfig {
  keys: (keyof ApiKeys)[];
  defaults: Record<string, unknown>;
}

export interface TelephonyProviderConfig {
  keys: (keyof ApiKeys)[];
}

export const STT_PROVIDERS: Record<SttProvider, SttProviderConfig> = {
  deepgram: {
    keys: ['DEEPGRAM_API_KEY'],
    defaults: {
      provider: 'deepgram',
      sampleRate: 8000,
      model: 'nova-2',
      language: 'en',
      smartFormat: true,
      punctuation: true,
      interimResults: true,
      endpointing: 300,
    },
  },
  'openai-realtime': {
    keys: ['OPENAI_API_KEY'],
    defaults: {
      provider: 'openai-realtime',
      sampleRate: 24000,
      model: 'gpt-4o-realtime-preview',
      voice: 'alloy',
    },
  },
  'openai-whisper': {
    keys: ['OPENAI_API_KEY'],
    defaults: {
      provider: 'openai-whisper',
      sampleRate: 16000,
      model: 'whisper-1',
      language: 'en',
    },
  },
  assemblyai: {
    keys: ['ASSEMBLYAI_API_KEY'],
    defaults: {
      provider: 'assemblyai',
      sampleRate: 16000,
      punctuate: true,
      formatText: true,
      interimResults: true,
    },
  },
  'groq-whisper': {
    keys: ['GROQ_API_KEY'],
    defaults: {
      provider: 'groq-whisper',
      sampleRate: 16000,
      model: 'whisper-large-v3',
      language: 'en',
    },
  },
  'aws-transcribe': {
    keys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    defaults: {
      provider: 'aws-transcribe',
      sampleRate: 8000,
      languageCode: 'en-US',
      enablePartialResultsStabilization: true,
    },
  },
  'google-cloud-stt': {
    keys: ['GOOGLE_APPLICATION_CREDENTIALS'],
    defaults: {
      provider: 'google-cloud-stt',
      sampleRate: 8000,
      languageCode: 'en-US',
      model: 'latest_long',
      enableAutomaticPunctuation: true,
      interimResults: true,
    },
  },
  mock: {
    keys: [],
    defaults: {
      provider: 'mock',
      sampleRate: 8000,
      delayMs: 100,
      transcriptions: ['Hello, how can I help you?'],
    },
  },
};

export const TTS_PROVIDERS: Record<TtsProvider, TtsProviderConfig> = {
  deepgram: {
    keys: ['DEEPGRAM_API_KEY'],
    defaults: {
      provider: 'deepgram',
      voice: 'asteria',
      model: 'aura',
      encoding: 'mulaw' as const,
      sampleRate: 8000,
    },
  },
  elevenlabs: {
    keys: ['ELEVENLABS_API_KEY'],
    defaults: {
      provider: 'elevenlabs',
      voice: 'rachel',
      model: 'eleven_turbo_v2',
      sampleRate: 8000,
      outputFormat: 'mulaw',
    },
  },
  cartesia: {
    keys: ['CARTESIA_API_KEY'],
    defaults: {
      provider: 'cartesia',
      voice: 'sonic-english',
      model: 'sonic-2',
      sampleRate: 8000,
      encoding: 'mulaw',
    },
  },
  'aws-polly': {
    keys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    defaults: {
      provider: 'aws-polly',
      voice: 'Joanna',
      engine: 'neural',
      sampleRate: 8000,
      outputFormat: 'pcm',
    },
  },
  'google-cloud-tts': {
    keys: ['GOOGLE_APPLICATION_CREDENTIALS'],
    defaults: {
      provider: 'google-cloud-tts',
      voice: 'en-US-Standard-J',
      languageCode: 'en-US',
      sampleRate: 8000,
      encoding: 'mulaw',
    },
  },
  mock: {
    keys: [],
    defaults: {
      provider: 'mock',
      sampleRate: 8000,
      delayMs: 50,
      responses: ['Hello! This is a mock TTS response.'],
    },
  },
};

export const TELEPHONY_PROVIDERS: Record<TelephonyProvider, TelephonyProviderConfig> = {
  twilio: {
    keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  },
  telnyx: {
    keys: ['TELNYX_API_KEY', 'TELNYX_SIP_DOMAIN'],
  },
  none: {
    keys: [],
  },
};
