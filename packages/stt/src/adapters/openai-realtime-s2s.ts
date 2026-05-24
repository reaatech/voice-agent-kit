import type {
  AgentResponse,
  AudioChunk,
  SpeechToSpeechConfig,
  ToolCall,
  Utterance,
} from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import { STTProviderInterface } from '../interface.js';

interface RealtimeMessage {
  type: string;
  event_id?: string;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic API message shapes
  [key: string]: any;
}

interface AudioOutputBuffer {
  chunks: AudioChunk[];
  sampleRate: number;
  encoding: 'linear16' | 'opus' | 'mulaw';
  channels: number;
}

export interface OpenAIRealtimeS2SOptions {
  apiUrl?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export class OpenAIRealtimeS2SProvider extends EventEmitter {
  readonly name = 'openai-realtime-s2s';

  private ws: WebSocket | null = null;
  private connected = false;
  private config: SpeechToSpeechConfig | null = null;
  private options: OpenAIRealtimeS2SOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private outputBuffer: AudioOutputBuffer = {
    chunks: [],
    sampleRate: 24000,
    encoding: 'linear16',
    channels: 1,
  };
  private currentTranscript = '';
  private responseInProgress = false;
  private audioTranscriptDeltas: string[] = [];
  private static readonly MAX_QUEUE_SIZE = 200;
  private toolCallsDuringTurn: ToolCall[] = [];
  private turnAudioStartTime = 0;

  constructor(options: OpenAIRealtimeS2SOptions = {}) {
    super();
    this.options = {
      apiUrl: 'api.openai.com',
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      ...options,
    };
  }

  async connect(config: SpeechToSpeechConfig): Promise<void> {
    this.config = config;
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const model = config.model || 'gpt-4o-realtime-preview-2024-12-17';
    const params = new URLSearchParams({ model });
    const url = `wss://${this.options.apiUrl}/v1/realtime?${params.toString()}`;

    return await new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        const timeout = setTimeout(() => {
          reject(new Error('OpenAI Realtime S2S connection timeout'));
        }, 15000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectCount = 0;
          this.sendSessionConfig(config);
          this.flushAudioQueue();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number) => {
          this.connected = false;
          if (code !== 1000) {
            this.attemptReconnect();
          }
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          this.emitError(error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  sendAudio(chunk: AudioChunk): void {
    if (!STTProviderInterface.validateAudioChunk(chunk)) {
      this.emitError(new Error('Invalid audio chunk'));
      return;
    }

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.audioQueue.length >= OpenAIRealtimeS2SProvider.MAX_QUEUE_SIZE) {
        this.audioQueue.shift();
      }
      this.audioQueue.push(chunk);
      return;
    }

    const converted = this.convertInputAudio(chunk);
    const base64 = converted.buffer.toString('base64');

    try {
      this.ws.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }),
      );
    } catch {
      this.emitError(new Error('Failed to send audio chunk'));
    }
  }

  onAudioOutput(cb: (chunk: AudioChunk) => void): void {
    this.on('audioOutput', cb);
  }

  onTranscript(cb: (utterance: Utterance) => void): void {
    this.on('transcript', cb);
  }

  onTurnComplete(cb: (response: AgentResponse) => void): void {
    this.on('turnComplete', cb);
  }

  onError(cb: (error: Error) => void): void {
    this.on('error', cb);
  }

  onEndOfTurn(cb: () => void): void {
    this.on('endOfTurn', cb);
  }

  async close(): Promise<void> {
    this.audioQueue = [];
    this.outputBuffer.chunks = [];
    this.currentTranscript = '';
    this.responseInProgress = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000);
      }
      this.ws = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private sendSessionConfig(config: SpeechToSpeechConfig): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const sessionConfig: Record<string, unknown> = {
      modalities: config.modalities ?? ['text', 'audio'],
      instructions: config.instructions || 'You are a helpful voice assistant.',
      voice: config.voice || 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
        language: 'en',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: config.vad?.threshold ?? 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: config.vad?.silenceDurationMs ?? 200,
      },
      tools: [],
      tool_choice: 'auto',
      temperature: config.temperature ?? 0.8,
    };

    if (config.inputAudioFormat) {
      sessionConfig.input_audio_format =
        config.inputAudioFormat.encoding === 'opus' ? 'opus' : 'pcm16';
    }

    if (config.outputAudioFormat) {
      sessionConfig.output_audio_format =
        config.outputAudioFormat.encoding === 'opus' ? 'opus' : 'pcm16';
    }

    if (config.model?.includes('gpt-4o-mini')) {
      delete sessionConfig.input_audio_transcription;
    }

    this.ws.send(
      JSON.stringify({
        type: 'session.update',
        session: sessionConfig,
      }),
    );

    if (config.outputAudioFormat) {
      this.outputBuffer = {
        chunks: [],
        sampleRate: config.outputAudioFormat.sampleRate,
        encoding: config.outputAudioFormat.encoding,
        channels: config.outputAudioFormat.channels,
      };
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: RealtimeMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'session.created':
          break;

        case 'session.updated':
          break;

        case 'input_audio_buffer.speech_started': {
          this.currentTranscript = '';
          this.toolCallsDuringTurn = [];
          this.turnAudioStartTime = 0;

          if (this.responseInProgress) {
            this.responseInProgress = false;
            this.emit('endOfTurn');
          }
          break;
        }

        case 'input_audio_buffer.speech_stopped': {
          break;
        }

        case 'input_audio_buffer.committed': {
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = message.transcript as string | undefined;
          if (transcript?.trim()) {
            this.currentTranscript = transcript;
            this.emitTranscript(this.currentTranscript, 0.95, true);
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.failed': {
          break;
        }

        case 'response.created': {
          this.responseInProgress = true;
          this.audioTranscriptDeltas = [];
          break;
        }

        case 'response.done': {
          this.responseInProgress = false;
          this.handleResponseDone(message);
          break;
        }

        case 'response.audio.delta': {
          if (message.delta) {
            this.handleAudioDelta(message.delta);
          }
          break;
        }

        case 'response.audio.done': {
          break;
        }

        case 'response.audio_transcript.delta': {
          const delta = message.delta as string | undefined;
          if (delta) {
            this.audioTranscriptDeltas.push(delta);
            const combined = this.audioTranscriptDeltas.join('');
            this.emitTranscript(combined, 0.8, false);
          }
          break;
        }

        case 'response.audio_transcript.done': {
          break;
        }

        case 'response.text.delta': {
          const delta = message.delta as string | undefined;
          if (delta) {
            this.emitTranscript(delta, 0.9, false);
          }
          break;
        }

        case 'response.text.done': {
          break;
        }

        case 'response.function_call_arguments.done': {
          const callId = message.call_id as string;
          const name = message.name as string;
          const argumentsStr = message.arguments as string;
          if (name && callId) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(argumentsStr || '{}');
            } catch {
              parsedArgs = { raw: argumentsStr };
            }
            this.toolCallsDuringTurn.push({
              name,
              arguments: parsedArgs,
            });
          }
          break;
        }

        case 'conversation.item.created': {
          const item = message.item as RealtimeMessage | undefined;
          if (item?.type === 'function_call_output') {
            const existing = this.toolCallsDuringTurn.find((tc) => tc.name === item.name);
            if (existing) {
              existing.result = { output: item.output as string };
            }
          }
          break;
        }

        case 'rate_limits.updated': {
          break;
        }

        case 'error':
          this.emitError(new Error(message.error?.message || 'OpenAI Realtime S2S error'));
          break;

        default:
          break;
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  private handleAudioDelta(deltaBase64: string): void {
    if (!deltaBase64) {
      return;
    }

    const audioBuffer = Buffer.from(deltaBase64, 'base64');

    if (this.turnAudioStartTime === 0) {
      this.turnAudioStartTime = Date.now();
    }

    const audioChunk: AudioChunk = {
      buffer: audioBuffer,
      sampleRate: this.outputBuffer.sampleRate,
      encoding: this.outputBuffer.encoding,
      channels: this.outputBuffer.channels,
      timestamp: Date.now(),
    };

    this.outputBuffer.chunks.push(audioChunk);
    this.emit('audioOutput', audioChunk);
  }

  private handleResponseDone(message: RealtimeMessage): void {
    const usage = message.response?.usage as
      | { total_tokens: number; input_tokens: number; output_tokens: number }
      | undefined;

    const output = message.response?.output as
      | Array<{
          type: string;
          content?: Array<{ type: string; transcript?: string }>;
        }>
      | undefined;

    const responseText = this.audioTranscriptDeltas.join('') || '';

    const toolCalls: ToolCall[] = [...this.toolCallsDuringTurn];
    this.toolCallsDuringTurn = [];

    const agentResponse: AgentResponse = {
      text: responseText,
      toolCalls,
      latencyMs: this.turnAudioStartTime > 0 ? Date.now() - this.turnAudioStartTime : 0,
      confidence: 0.95,
    };

    void usage;
    void output;

    this.emit('turnComplete', agentResponse);
  }

  private emitTranscript(transcript: string, confidence: number, isFinal: boolean): void {
    const utterance: Utterance = {
      transcript,
      confidence,
      isFinal,
      timestamp: Date.now(),
    };
    this.emit('transcript', utterance);
  }

  private emitError(error: Error): void {
    this.emit('error', error);
  }

  private convertInputAudio(chunk: AudioChunk): AudioChunk {
    const target = STTProviderInterface.convertAudioFormat(chunk, 24000, 'linear16');
    return target;
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.sendAudio(chunk);
      }
    }
  }

  private attemptReconnect(): void {
    if (!this.config || this.reconnectCount >= (this.options.reconnectAttempts ?? 3)) {
      return;
    }
    this.reconnectCount++;
    const config = this.config;
    setTimeout(() => {
      this.connect(config).catch(() => {
        this.emitError(new Error(`Failed to reconnect after ${this.reconnectCount} attempts`));
      });
    }, this.options.reconnectInterval ?? 1000);
  }
}

export function createOpenAIRealtimeS2SProvider(
  options?: OpenAIRealtimeS2SOptions,
): OpenAIRealtimeS2SProvider {
  return new OpenAIRealtimeS2SProvider(options);
}
