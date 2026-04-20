/**
 * Core type definitions for voice-agent-kit
 */

/** Audio chunk from telephony provider */
export interface AudioChunk {
  buffer: Buffer;
  sampleRate: number;
  encoding: 'mulaw' | 'linear16' | 'pcm';
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
  | 'pipeline:end';

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

/** Session configuration */
export interface SessionConfig {
  ttl: number;
  history: {
    maxTurns: number;
    maxTokens: number;
  };
}

/** Complete kit configuration */
export interface VoiceAgentKitConfig {
  mcp: MCPConfig;
  stt: STTConfig;
  tts: TTSConfig;
  latency: LatencyBudget;
  session: SessionConfig;
  bargeIn: BargeInConfig;
}
