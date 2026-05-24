import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import type { AssemblyAIConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface AssemblyAIOptions {
  apiUrl?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface AssemblyAIMessage {
  message_type: string;
  text?: string;
  confidence?: number;
  audio_end?: number;
  audio_start?: number;
  created?: string;
}

export class AssemblyAIProvider extends EventEmitter implements STTProvider {
  readonly name = 'assemblyai';

  private ws: WebSocket | null = null;
  private connected = false;
  private _config: AssemblyAIConfig | null = null;
  private options: Required<
    Pick<AssemblyAIOptions, 'apiUrl' | 'reconnectAttempts' | 'reconnectInterval'>
  >;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private static readonly MAX_QUEUE_SIZE = 200;

  constructor(options: AssemblyAIOptions = {}) {
    super();
    this.options = {
      apiUrl: options.apiUrl || 'api.assemblyai.com',
      reconnectAttempts: options.reconnectAttempts ?? 3,
      reconnectInterval: options.reconnectInterval ?? 1000,
    };
  }

  async connect(config: AssemblyAIConfig): Promise<void> {
    this._config = config;
    const apiKey = config.apiKey || process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      throw new Error('AssemblyAI API key is required');
    }

    const sampleRate = config.sampleRate || 16000;
    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      encoding: config.encoding || 'pcm_s16le',
    });

    const url = `wss://${this.options.apiUrl}/v2/realtime/ws?${params.toString()}`;

    return await new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            Authorization: apiKey,
          },
        });

        const timeout = setTimeout(() => {
          reject(new Error('AssemblyAI connection timeout'));
        }, 15000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectCount = 0;
          this.emit('connected');
          this.flushAudioQueue();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number) => {
          this.connected = false;
          this.emit('disconnected');
          if (code !== 1000 && code !== 1005) {
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
      if (this.audioQueue.length >= AssemblyAIProvider.MAX_QUEUE_SIZE) {
        this.audioQueue.shift();
      }
      this.audioQueue.push(chunk);
      return;
    }

    const targetEncoding = this._config?.encoding === 'pcm_mulaw' ? 'mulaw' : 'linear16';
    const targetSampleRate = this._config?.sampleRate || 16000;
    const converted = STTProviderInterface.convertAudioFormat(
      chunk,
      targetSampleRate,
      targetEncoding,
    );

    const base64 = converted.buffer.toString('base64');

    try {
      const message = JSON.stringify({
        audio_data: base64,
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
    this.audioQueue = [];

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ terminate_session: true }));
        } catch {
          // Ignore send errors during shutdown
        }
      }

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

  private handleMessage(data: Buffer): void {
    try {
      const message: AssemblyAIMessage = JSON.parse(data.toString());

      switch (message.message_type) {
        case 'PartialTranscript': {
          if (message.text?.trim()) {
            const utterance: Utterance = {
              transcript: message.text,
              confidence: message.confidence ?? 0.7,
              isFinal: false,
              timestamp: Date.now(),
            };
            this.emit('utterance', utterance);
          }
          break;
        }

        case 'FinalTranscript': {
          if (message.text?.trim()) {
            const utterance: Utterance = {
              transcript: message.text,
              confidence: message.confidence ?? 0.9,
              isFinal: true,
              timestamp: Date.now(),
            };
            this.emit('utterance', utterance);
            this.emit('endOfSpeech');
          }
          break;
        }

        case 'SessionTerminated': {
          this.connected = false;
          this.emit('disconnected');
          break;
        }

        case 'Error': {
          this.emit('error', new Error(message.text || 'AssemblyAI error'));
          break;
        }

        default:
          break;
      }
    } catch {
      // Ignore unparseable messages
    }
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

export function createAssemblyAIProvider(options?: AssemblyAIOptions): AssemblyAIProvider {
  return new AssemblyAIProvider(options);
}
