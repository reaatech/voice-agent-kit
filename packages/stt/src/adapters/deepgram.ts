import { EventEmitter } from 'events';

import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';
import WebSocket from 'ws';

import type { DeepgramConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface DeepgramSTTOptions {
  apiUrl?: string;
  version?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface DeepgramResponse {
  channel: {
    alternatives: Array<{
      transcript: string;
      confidence: number;
    }>;
  };
  is_final: boolean;
  speech_final?: boolean;
}

export class DeepgramSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'deepgram';

  private ws: WebSocket | null = null;
  private connected = false;
  private _config: DeepgramConfig | null = null;
  private options: DeepgramSTTOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private static readonly MAX_QUEUE_SIZE = 100;

  constructor(options: DeepgramSTTOptions = {}) {
    super();
    this.options = {
      apiUrl: 'api.deepgram.com',
      version: 'v1',
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      ...options,
    };
  }

  async connect(config: DeepgramConfig): Promise<void> {
    this._config = config;
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      throw new Error('Deepgram API key is required');
    }

    const params = new URLSearchParams({
      model: config.model || 'nova-2',
      language: config.language || 'en',
      smart_format: String(config.smartFormat ?? true),
      punctuate: String(config.punctuation ?? true),
      profanity_filter: String(config.profanityFilter ?? false),
      interim_results: String(config.interimResults ?? true),
      vad_events: String(config.vadEvents ?? true),
      endpointing: String(config.endpointing ?? 300),
      sample_rate: String(config.sampleRate || 8000),
      encoding: config.encoding === 'mulaw' ? 'mulaw' : 'linear16',
    });

    const url = `wss://${this.options.apiUrl}/${this.options.version}/listen?${params.toString()}`;

    return await new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            Authorization: `Token ${apiKey}`,
          },
        });

        this.ws.on('open', () => {
          this.connected = true;
          this.reconnectCount = 0;
          this.emit('connected');
          this.flushAudioQueue();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
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

    if (!this.connected || !this.ws) {
      if (this.audioQueue.length >= DeepgramSTTProvider.MAX_QUEUE_SIZE) {
        this.audioQueue.shift();
      }
      this.audioQueue.push(chunk);
      return;
    }

    this.ws.send(chunk.buffer);
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
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(data: Buffer): void {
    try {
      const response: DeepgramResponse = JSON.parse(data.toString());

      if (response.channel?.alternatives?.[0]) {
        const alternative = response.channel.alternatives[0];

        if (alternative.transcript) {
          const utterance: Utterance = {
            transcript: alternative.transcript,
            confidence: alternative.confidence,
            isFinal: response.is_final,
            timestamp: Date.now(),
          };

          this.emit('utterance', utterance);
        }
      }

      if (response.speech_final) {
        this.emit('endOfSpeech');
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0 && this.ws) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.ws.send(chunk.buffer);
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

export function createDeepgramSTTProvider(options?: DeepgramSTTOptions): DeepgramSTTProvider {
  return new DeepgramSTTProvider(options);
}
