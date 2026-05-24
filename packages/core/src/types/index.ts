/**
 * Core type definitions for voice-agent-kit
 */

/** Audio chunk from telephony provider */
export interface AudioChunk {
  buffer: Buffer;
  sampleRate: number;
  encoding: 'mulaw' | 'linear16' | 'pcm' | 'opus';
  channels: number;
  timestamp: number;
}

/** Transcribed utterance from STT */
export interface Utterance {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
  durationMs?: number;
}

/** Agent response from MCP server */
export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  latencyMs: number;
  confidence?: number;
}

/** Tool call made by agent */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/** Speech segment for TTS */
export interface SpeechSegment {
  audio: Buffer;
  textSource: string;
  segmentIndex: number;
  timestamp: number;
}

/** Session state */
export interface Session {
  sessionId: string;
  callSid: string;
  mcpEndpoint: string;
  sttProvider: string;
  ttsProvider: string;
  turns: Turn[];
  createdAt: Date;
  lastActivityAt: Date;
  ttl: number;
  metadata: Record<string, unknown>;
  status: 'active' | 'closed';
}

/** Conversation turn */
export interface Turn {
  turnId: string;
  userUtterance: string;
  agentResponse: string;
  timestamp: Date;
  latencyMs: number;
  toolCalls?: ToolCall[];
}

/** Pipeline event types */
export type PipelineEventType =
  | 'pipeline:start'
  | 'pipeline:stt:start'
  | 'pipeline:stt:interim'
  | 'pipeline:stt:final'
  | 'pipeline:stt:eos'
  | 'pipeline:mcp:request'
  | 'pipeline:mcp:response'
  | 'pipeline:tts:start'
  | 'pipeline:tts:first_byte'
  | 'pipeline:tts:chunk'
  | 'pipeline:tts:complete'
  | 'pipeline:turn:end'
  | 'pipeline:error'
  | 'pipeline:end'
  | 'pipeline:barge_in'
  | 'pipeline:vad:speech_start'
  | 'pipeline:vad:speech_end'
  | 'pipeline:vad:endpoint'
  | 'pipeline:dtmf:received'
  | 'pipeline:dtmf:complete'
  | 'pipeline:thinking:start'
  | 'pipeline:thinking:stop';

/** Pipeline event */
export interface PipelineEvent {
  type: PipelineEventType;
  sessionId: string;
  turnId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** Latency budget configuration */
export interface LatencyBudget {
  total: {
    target: number;
    hardCap: number;
  };
  stages: {
    stt: number;
    mcp: number;
    tts: number;
  };
}

/** STT provider configuration */
export interface STTConfig {
  provider: string;
  apiKey?: string;
  sampleRate: number;
  [key: string]: unknown;
}

/** TTS provider configuration */
export interface TTSConfig {
  provider: string;
  apiKey?: string;
  voice?: string;
  speed?: number;
  [key: string]: unknown;
}

/** MCP client configuration */
export interface MCPConfig {
  endpoint: string;
  auth?: {
    type: string;
    credentials: Record<string, string>;
  };
  timeout: number;
}

/** Barge-in configuration */
export interface BargeInConfig {
  enabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
}

/** DTMF input from telephony */
export interface DTMFInput {
  digit: string;
  timestamp: number;
  callSid: string;
  sequence: string;
}

/** DTMF configuration */
export interface DTMFConfig {
  enabled: boolean;
  interDigitTimeout: number;
  maxDigits: number;
  terminatorDigit?: string;
}

/** VAD configuration */
export interface VADConfig {
  provider: 'energy' | 'none';
  energyThreshold?: number;
  silenceTimeoutMs?: number;
  minSpeechDurationMs?: number;
  maxSpeechDurationMs?: number;
}

/** Thinking audio configuration */
export interface ThinkingAudioConfig {
  enabled: boolean;
  strategy: 'none' | 'silence' | 'filler' | 'backchannel';
  backchannelPhrases?: string[];
  fillerToneHz?: number;
  fillerVolume?: number;
  maxDurationMs?: number;
}

/** Session configuration */
export interface SessionConfig {
  ttl: number;
  history: {
    maxTurns: number;
    maxTokens: number;
  };
}

/** Transport type for different telephony/WebRTC backends */
export type TransportType = 'twilio' | 'webrtc' | 'telnyx' | 'signalwire' | 'vonage' | 'sip';

/** Pipeline execution mode */
export type PipelineMode = 'staged' | 'speech-to-speech';

/** Speech-to-speech provider configuration */
export interface SpeechToSpeechConfig {
  provider: 'openai-realtime' | 'gemini-live' | 'deepgram-speak';
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  temperature?: number;
  modalities?: ('text' | 'audio')[];
  inputAudioFormat?: {
    sampleRate: number;
    encoding: 'linear16' | 'opus';
    channels: number;
  };
  outputAudioFormat?: {
    sampleRate: number;
    encoding: 'linear16' | 'opus' | 'mulaw';
    channels: number;
  };
  vad?: {
    threshold?: number;
    silenceDurationMs?: number;
  };
}

/** Recording configuration */
export interface RecordingConfig {
  enabled: boolean;
  storage: 'memory' | 'filesystem' | 's3' | 'custom';
  directory?: string;
  s3Bucket?: string;
  s3Prefix?: string;
  saveAudio?: boolean;
  saveTranscript?: boolean;
  saveEvents?: boolean;
  format?: 'wav' | 'mp3' | 'raw';
}

/** Call recording data */
export interface CallRecording {
  sessionId: string;
  callSid: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  audioChunks: AudioChunk[];
  turns: TurnRecord[];
  events: PipelineEvent[];
  metadata: Record<string, unknown>;
}

/** Turn record for persisting conversation turns */
export interface TurnRecord {
  turnId: string;
  userUtterance: string;
  agentResponse: string;
  userAudio?: AudioChunk[];
  agentAudio?: AudioChunk[];
  startTime: number;
  endTime?: number;
  latencyMs: number;
  toolCalls?: ToolCall[];
  cost?: TurnCost;
}

/** Provider pricing configuration */
export interface ProviderPricing {
  stt?: {
    pricePerMinute?: number;
    pricePerHour?: number;
  };
  tts?: {
    pricePerCharacter: number;
    pricePer1k?: number;
  };
  llm?: {
    pricePerInputToken: number;
    pricePerOutputToken: number;
  };
}

/** Cost tracking configuration */
export interface CostTrackingConfig {
  enabled: boolean;
  currency: string;
  providers: Record<string, ProviderPricing>;
}

/** Cost for a single turn */
export interface TurnCost {
  sttCost: number;
  ttsCost: number;
  mcpCost: number;
  totalCost: number;
  currency: string;
}

/** Cost for a complete session */
export interface SessionCost {
  sessionId: string;
  turns: Array<{ turnId: string; cost: TurnCost }>;
  totalCost: number;
  startTime: number;
  endTime?: number;
}

/** Complete kit configuration */
export interface VoiceAgentKitConfig {
  mcp: MCPConfig;
  stt: STTConfig;
  tts: TTSConfig;
  latency: LatencyBudget;
  session: SessionConfig;
  bargeIn: BargeInConfig;
  vad?: VADConfig;
  dtmf?: DTMFConfig;
  thinkingAudio?: ThinkingAudioConfig;
  mode?: PipelineMode;
  speechToSpeech?: SpeechToSpeechConfig;
  transport?: {
    type?: TransportType;
    sampleRate?: number;
    channels?: number;
  };
  recording?: RecordingConfig;
  cost?: CostTrackingConfig;
}
