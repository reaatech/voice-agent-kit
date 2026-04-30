import { EventEmitter } from 'events';

import { SpeechClient } from '@google-cloud/speech';
import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';

import type { GoogleCloudSTTConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface GoogleCloudSTTOptions {
  projectId?: string;
  keyFilename?: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface RecognitionStream extends NodeJS.WritableStream {
  on(event: 'data', listener: (data: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;
  destroy(): this;
}

export class GoogleCloudSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'google-cloud-stt';

  private client: SpeechClient | null = null;
  private connected = false;
  private _config: GoogleCloudSTTConfig | null = null;
  private options: GoogleCloudSTTOptions;
  private reconnectCount = 0;
  private audioQueue: AudioChunk[] = [];
  private recognizeStream: RecognitionStream | null = null;

  constructor(options: GoogleCloudSTTOptions = {}) {
    super();
    this.options = {
      reconnectAttempts: 3,
      reconnectInterval: 1000,
      ...options,
    };
  }

  async connect(config: GoogleCloudSTTConfig): Promise<void> {
    this._config = config;

    const apiKey = config.apiKey;
    const projectId = config.projectId;

    if (!apiKey && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        'Google Cloud credentials are required (API key or GOOGLE_APPLICATION_CREDENTIALS)',
      );
    }

    this.client = new SpeechClient({
      projectId: projectId,
      keyFilename: apiKey ? undefined : this.options.keyFilename,
      credentials: apiKey ? { client_email: '', private_key: apiKey } : undefined,
    });

    try {
      this.recognizeStream = (await this.startStreamingRecognition(config)) as RecognitionStream;
      this.setupRecognitionHandlers();
      this.connected = true;
      this.reconnectCount = 0;
      this.emit('connected');
      this.flushAudioQueue();
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async startStreamingRecognition(
    config: GoogleCloudSTTConfig,
  ): Promise<RecognitionStream> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    const request = {
      config: {
        encoding: config.encoding === 'mulaw' ? 'MULAW' : ('LINEAR16' as const),
        sampleRateHertz: config.sampleRate || 8000,
        languageCode: config.languageCode || 'en-US',
        alternativeLanguageCodes: config.alternativeLanguageCodes,
        model: config.model || 'latest_short',
        useEnhanced: config.useEnhanced,
        profanityFilter: config.profanityFilter,
        enableAutomaticPunctuation: config.enableAutomaticPunctuation,
        enableWordTimeOffsets: config.enableWordTimeOffsets,
        maxAlternatives: config.maxAlternatives,
        singleUtterance: config.singleUtterance,
      },
      interimResults: config.interimResults !== false,
    };

    // The Google Cloud SDK returns a Pumpify stream - cast it directly
    const recognizeStream = this.client.streamingRecognize(request);
    return recognizeStream as unknown as RecognitionStream;
  }

  private setupRecognitionHandlers(): void {
    if (!this.recognizeStream) {
      return;
    }

    this.recognizeStream.on('data', (response: unknown) => {
      this.handleResponse(response);
    });

    this.recognizeStream.on('error', (error: Error) => {
      if (this.connected) {
        this.emit('error', error);
        this.attemptReconnect();
      }
    });

    this.recognizeStream.on('end', () => {
      if (this.connected) {
        this.emit('disconnected');
      }
    });
  }

  private handleResponse(response: unknown): void {
    const typedResponse = response as {
      results?: Array<{
        alternatives?: Array<{ transcript?: string; confidence?: number }>;
        isFinal?: boolean;
      }>;
    };
    if (!typedResponse.results || typedResponse.results.length === 0) {
      return;
    }

    for (const result of typedResponse.results) {
      if (!result) {
        continue;
      }
      if (!result.alternatives || result.alternatives.length === 0) {
        continue;
      }

      const alternative = result.alternatives[0];

      if (alternative?.transcript) {
        const utterance: Utterance = {
          transcript: alternative.transcript,
          confidence: alternative.confidence || 0.9,
          isFinal: result.isFinal ?? false,
          timestamp: Date.now(),
        };

        this.emit('utterance', utterance);

        if (result.isFinal) {
          this.emit('endOfSpeech');
        }
      }
    }
  }

  streamAudio(chunk: AudioChunk): void {
    if (!STTProviderInterface.validateAudioChunk(chunk)) {
      this.emit('error', new Error('Invalid audio chunk'));
      return;
    }

    if (!this.connected || !this.recognizeStream) {
      this.audioQueue.push(chunk);
      return;
    }

    // Convert mulaw to linear16 for Google Cloud STT if needed
    let audioData = chunk.buffer;
    if (chunk.encoding === 'mulaw') {
      audioData = STTProviderInterface.mulawToLinear16(chunk.buffer);
    }

    this.recognizeStream.write(audioData);
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

    if (this.recognizeStream) {
      this.recognizeStream.destroy();
      this.recognizeStream = null;
    }

    if (this.client) {
      void this.client.close();
    }
  }

  isConnected(): boolean {
    return this.connected;
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
      this.emit('error', new Error(`Failed to reconnect after ${this.reconnectCount} attempts`));
      return;
    }

    this.reconnectCount++;
    const config = this._config;

    void this.connect(config).catch((error) => {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    });
  }
}

export function createGoogleCloudSTTProvider(
  options?: GoogleCloudSTTOptions,
): GoogleCloudSTTProvider {
  return new GoogleCloudSTTProvider(options);
}
