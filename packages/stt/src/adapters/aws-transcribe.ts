import type { LanguageCode, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';

import type { AWSTranscribeConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface AWSTranscribeOptions {
  region?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export class AWSTranscribeProvider extends EventEmitter implements STTProvider {
  readonly name = 'aws-transcribe';

  private client: TranscribeStreamingClient | null = null;
  private connected = false;
  private _config: AWSTranscribeConfig | null = null;
  private options: AWSTranscribeOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private transcriptionStream: AsyncIterable<unknown> | null = null;
  private audioInputQueue: Uint8Array[] = [];
  private audioInputResolver: (() => void) | null = null;
  private transcribeModule: typeof import('@aws-sdk/client-transcribe-streaming') | null = null;
  private credModule: typeof import('@aws-sdk/credential-provider-ini') | null = null;

  constructor(options: AWSTranscribeOptions = {}) {
    super();
    this.options = {
      region: 'us-east-1',
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      ...options,
    };
  }

  async connect(config: AWSTranscribeConfig): Promise<void> {
    this._config = config;

    const apiKey = config.apiKey;
    const region = config.region || this.options.region || 'us-east-1';

    if (!apiKey && !process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS credentials are required (API key or AWS_ACCESS_KEY_ID)');
    }

    // Lazily load the AWS SDK so it is only resolved when this provider is
    // actually used, keeping it out of the install/startup path for consumers
    // who only need another provider.
    if (!this.transcribeModule) {
      this.transcribeModule = await import('@aws-sdk/client-transcribe-streaming');
    }
    const { TranscribeStreamingClient } = this.transcribeModule;

    if (apiKey) {
      this.client = new TranscribeStreamingClient({
        region,
        credentials: {
          accessKeyId: apiKey,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });
    } else {
      if (!this.credModule) {
        this.credModule = await import('@aws-sdk/credential-provider-ini');
      }
      this.client = new TranscribeStreamingClient({
        region,
        credentials: this.credModule.fromIni(),
      });
    }

    try {
      this.transcriptionStream = await this.startTranscription(config);
      this.connected = true;
      this.reconnectCount = 0;
      this.emit('connected');
      this.flushAudioQueue();
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async startTranscription(config: AWSTranscribeConfig): Promise<AsyncIterable<unknown>> {
    if (!this.client || !this.transcribeModule) {
      throw new Error('Client not initialized');
    }

    const { MediaEncoding, StartStreamTranscriptionCommand } = this.transcribeModule;

    const input = {
      LanguageCode: (config.languageCode || 'en-US') as LanguageCode,
      MediaEncoding: MediaEncoding.PCM,
      MediaSampleRateHertz: config.sampleRate || 8000,
      VocabularyName: config.vocabularyName as string | undefined,
      ShowSpeakerLabels: config.showSpeakerLabels as boolean | undefined,
      MaxSpeakerLabels: config.maxSpeakerLabels as number | undefined,
      EnableChannelIdentification: config.enableChannelIdentification as boolean | undefined,
      NumberOfChannels: config.numberOfChannels as number | undefined,
      AudioStream: this.createAudioStream(),
    };
    const command = new StartStreamTranscriptionCommand(input as never);

    const response = await this.client.send(command);
    return response.TranscriptResultStream ?? (async function* () {})();
  }

  streamAudio(chunk: AudioChunk): void {
    if (!STTProviderInterface.validateAudioChunk(chunk)) {
      this.emit('error', new Error('Invalid audio chunk'));
      return;
    }

    if (!this.connected || !this.client) {
      this.audioQueue.push(chunk);
      return;
    }

    // Convert mulaw to linear16 for AWS Transcribe
    let audioData = chunk.buffer;
    if (chunk.encoding === 'mulaw') {
      audioData = STTProviderInterface.mulawToLinear16(chunk.buffer);
    }

    this.audioInputQueue.push(audioData);
    if (this.audioInputResolver) {
      this.audioInputResolver();
      this.audioInputResolver = null;
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
    this.connected = false;

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.transcriptionStream = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async processTranscriptionStream(): Promise<void> {
    if (!this.transcriptionStream) {
      return;
    }

    try {
      for await (const event of this.transcriptionStream) {
        // The streaming API yields a tagged union; transcripts arrive as
        // `TranscriptEvent.Transcript.Results[]` (see @aws-sdk/client-transcribe-streaming
        // `TranscriptResultStream`). Other members are exceptions/$unknown.
        const typedEvent = event as {
          TranscriptEvent?: { Transcript?: { Results?: unknown[] } };
        };
        const results = typedEvent.TranscriptEvent?.Transcript?.Results;

        if (!results) {
          continue;
        }

        for (const result of results) {
          // Streaming `Alternative` exposes `Transcript` and `Items` but no
          // per-alternative confidence, so we surface a fixed confidence.
          const typedResult = result as {
            Alternatives?: Array<{ Transcript?: string }>;
            IsPartial?: boolean;
          };
          if (typedResult.Alternatives && typedResult.Alternatives.length > 0) {
            const alternative = typedResult.Alternatives[0];

            if (alternative?.Transcript) {
              const utterance: Utterance = {
                transcript: alternative.Transcript,
                confidence: 0.9,
                isFinal: typedResult.IsPartial === false,
                timestamp: Date.now(),
              };

              this.emit('utterance', utterance);

              // Detect end of speech from final results
              if (typedResult.IsPartial === false) {
                this.emit('endOfSpeech');
              }
            }
          }
        }
      }
    } catch (error) {
      if (this.connected) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
        this.attemptReconnect();
      }
    }
  }

  private async *createAudioStream(): AsyncIterable<{ AudioEvent: { AudioChunk: Uint8Array } }> {
    while (this.connected) {
      if (this.audioInputQueue.length === 0) {
        await new Promise<void>((resolve) => {
          this.audioInputResolver = resolve;
        });
      }
      const chunk = this.audioInputQueue.shift();
      if (chunk) {
        yield { AudioEvent: { AudioChunk: chunk } };
      }
    }
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.streamAudio(chunk);
      }
    }

    // Start processing the transcription stream
    this.processTranscriptionStream().catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  private attemptReconnect(): void {
    if (!this._config || this.reconnectCount >= (this.options.reconnectAttempts ?? 3)) {
      this.emit('error', new Error(`Failed to reconnect after ${this.reconnectCount} attempts`));
      return;
    }

    this.reconnectCount++;
    const config = this._config;

    setTimeout(() => {
      this.connect(config).catch((err) => {
        this.emit('error', err);
      });
    }, this.options.reconnectInterval ?? 1000);
  }
}

export function createAWSTranscribeProvider(options?: AWSTranscribeOptions): AWSTranscribeProvider {
  return new AWSTranscribeProvider(options);
}
