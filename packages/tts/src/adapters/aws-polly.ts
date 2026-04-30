import { EventEmitter } from 'events';

import { Engine, OutputFormat, PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import type { AudioChunk } from '@reaatech/voice-agent-core';

import type { AWSPollyConfig, TTSProvider } from '../interface.js';

export interface AWSPollyOptions {
  region?: string;
  defaultVoiceId?: string;
  defaultEngine?: Engine;
}

export class AWSPollyProvider extends EventEmitter implements TTSProvider {
  readonly name = 'aws-polly';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;

  private client: PollyClient | null = null;
  private connected = false;
  private _config: AWSPollyConfig | null = null;
  private options: AWSPollyOptions;
  private isCancelled = false;

  constructor(options: AWSPollyOptions = {}) {
    super();
    this.options = {
      region: 'us-east-1',
      defaultVoiceId: 'Joanna',
      defaultEngine: Engine.NEURAL,
      ...options,
    };
  }

  async connect(config: AWSPollyConfig): Promise<void> {
    this._config = config;

    const apiKey = config.apiKey;
    const region = config.region || this.options.region || 'us-east-1';

    if (!apiKey && !process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS credentials are required (API key or AWS_ACCESS_KEY_ID)');
    }

    this.client = new PollyClient({
      region,
      credentials: apiKey
        ? {
            accessKeyId: apiKey,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
          }
        : fromIni(),
    });

    this.connected = true;
    this.emit('connected');
  }

  async *synthesize(text: string, config?: Partial<AWSPollyConfig>): AsyncIterable<AudioChunk> {
    if (!this.connected || !this._config) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Lazy-initialize client if not already created
    if (!this.client) {
      const apiKey = this._config.apiKey;
      const region = this._config.region || this.options.region || 'us-east-1';
      this.client = new PollyClient({
        region,
        credentials: apiKey
          ? {
              accessKeyId: apiKey,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            }
          : fromIni(),
      });
    }

    const fullConfig: AWSPollyConfig = {
      ...this._config,
      ...config,
    } as AWSPollyConfig;

    const voiceId = fullConfig.voiceId || this.options.defaultVoiceId || 'Joanna';
    const engine = fullConfig.engine === 'standard' ? Engine.STANDARD : Engine.NEURAL;
    const languageCode = fullConfig.languageCode || 'en-US';
    const sampleRate = fullConfig.sampleRate || 8000;
    const textType = fullConfig.textType === 'ssml' ? 'ssml' : 'text';

    this.isCancelled = false;

    try {
      const input = {
        Text: text,
        VoiceId: voiceId as never,
        Engine: engine,
        LanguageCode: languageCode as never,
        OutputFormat: OutputFormat.PCM,
        SampleRate: sampleRate.toString(),
        TextType: textType as never,
      };

      const command = new SynthesizeSpeechCommand(input);
      const response = await this.client.send(command);

      if (response.AudioStream) {
        for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
          if (this.isCancelled) {
            break;
          }
          const audioChunk: AudioChunk = {
            buffer: Buffer.from(chunk),
            sampleRate: sampleRate,
            encoding: 'pcm',
            channels: 1,
            timestamp: Date.now(),
          };
          yield audioChunk;
        }
      }
    } catch (error) {
      if (!this.isCancelled) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  cancel(): void {
    this.isCancelled = true;
  }

  onError(cb: (error: Error) => void): void {
    this.on('error', cb);
  }

  async close(): Promise<void> {
    this.cancel();
    this.connected = false;

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export function createAWSPollyProvider(options?: AWSPollyOptions): AWSPollyProvider {
  return new AWSPollyProvider(options);
}
