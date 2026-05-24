import type { Engine, PollyClient } from '@aws-sdk/client-polly';
import type { AudioChunk } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';

import type {
  AWSPollyConfig,
  CartesiaConfig,
  DeepgramTTSConfig,
  ElevenLabsConfig,
  GoogleCloudTTSConfig,
  TTSProvider,
} from '../interface.js';

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
  private pollyModule: typeof import('@aws-sdk/client-polly') | null = null;
  private credModule: typeof import('@aws-sdk/credential-provider-ini') | null = null;

  constructor(options: AWSPollyOptions = {}) {
    super();
    this.options = {
      region: 'us-east-1',
      defaultVoiceId: 'Joanna',
      ...options,
    };
  }

  /**
   * Lazily load the AWS SDK so it is only resolved when this provider is
   * actually used, keeping it out of the install/startup path for consumers
   * who only need another provider.
   */
  private async loadSdk(): Promise<typeof import('@aws-sdk/client-polly')> {
    if (!this.pollyModule) {
      this.pollyModule = await import('@aws-sdk/client-polly');
    }
    return this.pollyModule;
  }

  private async createClient(config: AWSPollyConfig): Promise<PollyClient> {
    const { PollyClient } = await this.loadSdk();
    const region = config.region || this.options.region || 'us-east-1';
    const apiKey = config.apiKey;

    if (apiKey) {
      return new PollyClient({
        region,
        credentials: {
          accessKeyId: apiKey,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    }

    if (!this.credModule) {
      this.credModule = await import('@aws-sdk/credential-provider-ini');
    }
    return new PollyClient({ region, credentials: this.credModule.fromIni() });
  }

  async connect(config: AWSPollyConfig): Promise<void> {
    this._config = config;

    const apiKey = config.apiKey;

    if (!apiKey && !process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS credentials are required (API key or AWS_ACCESS_KEY_ID)');
    }

    this.client = await this.createClient(config);

    this.connected = true;
    this.emit('connected');
  }

  async *synthesize(
    text: string,
    config?:
      | DeepgramTTSConfig
      | AWSPollyConfig
      | GoogleCloudTTSConfig
      | ElevenLabsConfig
      | CartesiaConfig,
  ): AsyncIterable<AudioChunk> {
    if (!this.connected || !this._config) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Lazy-initialize client if not already created
    if (!this.client) {
      this.client = await this.createClient(this._config);
    }

    const { SynthesizeSpeechCommand, OutputFormat, Engine } = await this.loadSdk();

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
