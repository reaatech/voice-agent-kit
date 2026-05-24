import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import type { OpenAIRealtimeConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface OpenAIRealtimeOptions {
  apiUrl?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  commitIntervalMs?: number;
}

interface RealtimeMessage {
  type: string;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic message shapes from the API
  [key: string]: any;
}

export class OpenAIRealtimeSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'openai-realtime';

  private ws: WebSocket | null = null;
  private connected = false;
  private _config: OpenAIRealtimeConfig | null = null;
  private options: OpenAIRealtimeOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private commitTimer: ReturnType<typeof setInterval> | null = null;
  private speechActive = false;
  private static readonly MAX_QUEUE_SIZE = 200;

  constructor(options: OpenAIRealtimeOptions = {}) {
    super();
    this.options = {
      apiUrl: 'api.openai.com',
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      commitIntervalMs: 500,
      ...options,
    };
  }

  async connect(config: OpenAIRealtimeConfig): Promise<void> {
    this._config = config;
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const params = new URLSearchParams({
      model: config.model || 'gpt-4o-realtime-preview',
    });

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
          reject(new Error('OpenAI Realtime connection timeout'));
        }, 15000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectCount = 0;
          this.emit('connected');

          this.sendSessionUpdate(config);
          this.startCommitTimer();
          this.flushAudioQueue();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number) => {
          this.connected = false;
          this.stopCommitTimer();
          this.emit('disconnected');
          if (code !== 1000) {
            this.attemptReconnect();
          }
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          this.emit('error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  streamAudio(chunk: AudioChunk): void {
    if (!STTProviderInterface.validateAudioChunk(chunk)) {
      this.emit('error', new Error('Invalid audio chunk'));
      return;
    }

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.audioQueue.length >= OpenAIRealtimeSTTProvider.MAX_QUEUE_SIZE) {
        this.audioQueue.shift();
      }
      this.audioQueue.push(chunk);
      return;
    }

    const converted = this.convertAudioChunk(chunk);
    const base64 = converted.buffer.toString('base64');

    try {
      const message = JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      });
      this.ws.send(message);
    } catch {
      this.emit('error', new Error('Failed to send audio chunk'));
    }
  }

  onUtterance(cb: (utterance: Utterance) => void): void {
    this.on('utterance', cb);
  }

  onEndOfSpeech(cb: () => void): void {
    this.on('endOfSpeech', cb);
  }

  onError(cb: (error: Error) => void): void {
    this.on('error', cb);
  }

  async close(): Promise<void> {
    this.stopCommitTimer();
    this.audioQueue = [];

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000);
      }
      this.ws = null;
    }

    this.connected = false;
    this.speechActive = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private sendSessionUpdate(config: OpenAIRealtimeConfig): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const sessionConfig: Record<string, unknown> = {
      modalities: ['text'],
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
        language: config.language || 'en',
      },
      voice: config.voice || 'alloy',
      instructions: config.instructions || '',
    };

    this.ws.send(
      JSON.stringify({
        type: 'session.update',
        session: sessionConfig,
      }),
    );
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: RealtimeMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'input_audio_buffer.speech_started':
          this.speechActive = true;
          break;

        case 'input_audio_buffer.speech_stopped':
          this.speechActive = false;
          this.commitAndRequestResponse();
          break;

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = message.transcript as string | undefined;
          if (transcript?.trim()) {
            this.emitUtterance(transcript, 0.95, true);
          }
          break;
        }

        case 'response.audio_transcript.done': {
          const transcript = message.transcript as string | undefined;
          if (transcript?.trim()) {
            this.emitUtterance(transcript, 0.95, true);
            if (message.speech_final !== false) {
              this.emit('endOfSpeech');
            }
          }
          break;
        }

        case 'error':
          this.emit('error', new Error(message.error?.message || 'OpenAI Realtime error'));
          break;

        default:
          break;
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  private emitUtterance(transcript: string, confidence: number, isFinal: boolean): void {
    const utterance: Utterance = {
      transcript,
      confidence,
      isFinal,
      timestamp: Date.now(),
    };
    this.emit('utterance', utterance);
  }

  private commitAndRequestResponse(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));

    this.ws.send(
      JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text'] },
      }),
    );
  }

  private startCommitTimer(): void {
    this.stopCommitTimer();
    this.commitTimer = setInterval(() => {
      if (this.speechActive && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.commitAndRequestResponse();
      }
    }, this.options.commitIntervalMs);
  }

  private stopCommitTimer(): void {
    if (this.commitTimer) {
      clearInterval(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private convertAudioChunk(chunk: AudioChunk): AudioChunk {
    const target = STTProviderInterface.convertAudioFormat(chunk, 24000, 'linear16');
    return target;
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.streamAudio(chunk);
      }
    }
  }

  private attemptReconnect(): void {
    if (!this._config || this.reconnectCount >= (this.options.reconnectAttempts ?? 3)) {
      return;
    }
    this.reconnectCount++;
    const config = this._config;
    setTimeout(() => {
      this.connect(config).catch(() => {
        this.emit('error', new Error(`Failed to reconnect after ${this.reconnectCount} attempts`));
      });
    }, this.options.reconnectInterval ?? 1000);
  }
}

export function createOpenAIRealtimeSTTProvider(
  options?: OpenAIRealtimeOptions,
): OpenAIRealtimeSTTProvider {
  return new OpenAIRealtimeSTTProvider(options);
}
