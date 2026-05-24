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

interface GeminiLiveMessage {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic API message shapes
  [key: string]: any;
}

interface GeminiServerContent {
  modelTurn?: {
    parts?: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
      functionCall?: {
        name: string;
        args: Record<string, unknown>;
      };
      functionResponse?: {
        name: string;
        response: Record<string, unknown>;
      };
    }>;
  };
  turnComplete?: boolean;
  interrupted?: boolean;
}

interface AudioOutputState {
  chunks: AudioChunk[];
  sampleRate: number;
  encoding: 'linear16' | 'opus' | 'mulaw';
  channels: number;
}

export interface GeminiLiveS2SOptions {
  apiUrl?: string;
  apiVersion?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export class GeminiLiveS2SProvider extends EventEmitter {
  readonly name = 'gemini-live-s2s';

  private ws: WebSocket | null = null;
  private connected = false;
  private config: SpeechToSpeechConfig | null = null;
  private options: GeminiLiveS2SOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private outputState: AudioOutputState = {
    chunks: [],
    sampleRate: 24000,
    encoding: 'linear16',
    channels: 1,
  };
  private currentTranscript = '';
  private audioTranscriptParts: string[] = [];
  private isProcessingTurn = false;
  private toolCallsDuringTurn: ToolCall[] = [];
  private turnStartTime = 0;
  private static readonly MAX_QUEUE_SIZE = 200;

  constructor(options: GeminiLiveS2SOptions = {}) {
    super();
    this.options = {
      apiUrl: 'generativelanguage.googleapis.com',
      apiVersion: 'v1alpha',
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      ...options,
    };
  }

  async connect(config: SpeechToSpeechConfig): Promise<void> {
    this.config = config;
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    const baseUrl = this.options.apiUrl || 'generativelanguage.googleapis.com';
    const version = this.options.apiVersion || 'v1alpha';
    const modelName = config.model || 'gemini-2.0-flash-live-001';
    const url = `wss://${baseUrl}/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    return await new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          reject(new Error('Gemini Live connection timeout'));
        }, 15000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectCount = 0;
          this.sendSetupConfig(config, modelName);
          this.flushAudioQueue();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number) => {
          this.connected = false;
          this.isProcessingTurn = false;
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
      if (this.audioQueue.length >= GeminiLiveS2SProvider.MAX_QUEUE_SIZE) {
        this.audioQueue.shift();
      }
      this.audioQueue.push(chunk);
      return;
    }

    const converted = this.convertInputAudio(chunk);
    const base64 = converted.buffer.toString('base64');
    const mimeType = this.getInputMimeType();

    if (!this.isProcessingTurn) {
      this.isProcessingTurn = true;
    }

    try {
      this.ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [
              {
                mime_type: mimeType,
                data: base64,
              },
            ],
          },
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
    this.outputState.chunks = [];
    this.currentTranscript = '';
    this.isProcessingTurn = false;

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

  private sendSetupConfig(config: SpeechToSpeechConfig, modelName: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const outputSampleRate = config.outputAudioFormat?.sampleRate ?? 24000;

    const setupMessage: Record<string, unknown> = {
      setup: {
        model: `models/${modelName}`,
        generation_config: {
          temperature: config.temperature ?? 0.8,
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: config.voice || 'Puck',
              },
            },
          },
        },
        system_instruction: {
          parts: [
            {
              text: config.instructions || 'You are a helpful voice assistant.',
            },
          ],
        },
        tools: [],
      },
    };

    if (config.inputAudioFormat) {
      this.outputState.sampleRate = config.inputAudioFormat.sampleRate;
      this.outputState.encoding = config.inputAudioFormat.encoding;
    }

    if (config.outputAudioFormat) {
      this.outputState = {
        chunks: [],
        sampleRate: config.outputAudioFormat.sampleRate,
        encoding: config.outputAudioFormat.encoding,
        channels: config.outputAudioFormat.channels,
      };
    }

    this.ws.send(JSON.stringify(setupMessage));

    void outputSampleRate;
    void modelName;
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: GeminiLiveMessage = JSON.parse(data.toString());

      if (message.setupComplete) {
        return;
      }

      if (message.serverContent) {
        this.handleServerContent(message.serverContent as GeminiServerContent);
        return;
      }

      if (message.toolCall) {
        this.handleToolCall(message.toolCall as Record<string, unknown>);
        return;
      }

      if (message.toolCallCancellation) {
        return;
      }

      if (message.error) {
        const errMsg = (message.error as Record<string, unknown>).message as string;
        this.emitError(new Error(errMsg || 'Gemini Live error'));
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.isProcessingTurn = false;
      this.emit('endOfTurn');
      return;
    }

    if (content.modelTurn) {
      const turn = content.modelTurn;
      this.isProcessingTurn = true;

      if (this.turnStartTime === 0) {
        this.turnStartTime = Date.now();
      }

      if (turn.parts) {
        for (const part of turn.parts) {
          if (part.text !== undefined) {
            this.audioTranscriptParts.push(part.text);
            this.currentTranscript = this.audioTranscriptParts.join('');
            this.emitTranscript(this.currentTranscript, 0.9, false);
          }

          if (part.inlineData) {
            const audioData = part.inlineData;
            this.handleAudioData(audioData.data, audioData.mimeType);
          }

          if (part.functionCall) {
            this.toolCallsDuringTurn.push({
              name: part.functionCall.name,
              arguments: part.functionCall.args,
            });
          }

          if (part.functionResponse) {
            const existing = this.toolCallsDuringTurn.find(
              (tc) => tc.name === part.functionResponse?.name,
            );
            if (existing) {
              existing.result = part.functionResponse.response;
            }
          }
        }
      }
    }

    if (content.turnComplete) {
      this.handleTurnComplete();
    }
  }

  private handleToolCall(toolCall: Record<string, unknown>): void {
    const functionCalls = toolCall.functionCalls as
      | Array<{
          name: string;
          args: Record<string, unknown>;
        }>
      | undefined;

    if (functionCalls) {
      for (const fc of functionCalls) {
        this.toolCallsDuringTurn.push({
          name: fc.name,
          arguments: fc.args,
        });
      }
    }
  }

  private handleAudioData(dataBase64: string, mimeType: string): void {
    if (!dataBase64) {
      return;
    }

    const audioBuffer = Buffer.from(dataBase64, 'base64');
    const rate = this.outputState.sampleRate;

    const audioChunk: AudioChunk = {
      buffer: audioBuffer,
      sampleRate: rate,
      encoding: this.outputState.encoding,
      channels: this.outputState.channels,
      timestamp: Date.now(),
    };

    this.outputState.chunks.push(audioChunk);
    this.emit('audioOutput', audioChunk);

    void mimeType;
  }

  private handleTurnComplete(): void {
    this.isProcessingTurn = false;

    const responseText = this.audioTranscriptParts.join('') || '';
    const toolCalls: ToolCall[] = [...this.toolCallsDuringTurn];

    this.audioTranscriptParts = [];
    this.toolCallsDuringTurn = [];

    const agentResponse: AgentResponse = {
      text: responseText,
      toolCalls,
      latencyMs: this.turnStartTime > 0 ? Date.now() - this.turnStartTime : 0,
      confidence: 0.95,
    };

    this.turnStartTime = 0;

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
    return STTProviderInterface.convertAudioFormat(chunk, 24000, 'linear16');
  }

  private getInputMimeType(): string {
    if (this.config?.inputAudioFormat?.encoding === 'opus') {
      return 'audio/opus';
    }
    return 'audio/pcm';
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

export function createGeminiLiveS2SProvider(options?: GeminiLiveS2SOptions): GeminiLiveS2SProvider {
  return new GeminiLiveS2SProvider(options);
}
