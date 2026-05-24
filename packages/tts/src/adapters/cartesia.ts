import type { AudioChunk } from '@reaatech/voice-agent-core';

import type { CartesiaConfig, TTSProvider } from '../interface.js';
import { TTSProviderInterface } from '../interface.js';

export interface CartesiaTTSOptions {
  apiUrl?: string;
}

interface CartesiaTTSRequest {
  modelId: string;
  transcript: string;
  voice: {
    mode: 'id';
    id: string;
  };
  outputFormat: {
    container: 'raw' | 'wav' | 'mp3';
    encoding: 'pcm_f32le' | 'pcm_s16le' | 'pcm_mulaw';
    sampleRate: number;
  };
  language?: string;
  speed?: string;
  emotion?: string[];
}

export class CartesiaTTSProvider implements TTSProvider {
  readonly name = 'cartesia';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;

  private options: CartesiaTTSOptions;
  private lastLatency: number | null = null;
  private abortController: AbortController | null = null;
  private connected = false;
  private _config: CartesiaConfig | null = null;

  constructor(options: CartesiaTTSOptions = {}) {
    this.options = {
      apiUrl: 'api.cartesia.ai',
      ...options,
    };
  }

  async connect(config: CartesiaConfig): Promise<void> {
    const apiKey = config.apiKey || process.env.CARTESIA_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Cartesia API key is required. Set CARTESIA_API_KEY or pass apiKey in config.',
      );
    }

    this._config = { ...config, apiKey };
    this.connected = true;
  }

  async *synthesize(text: string, config: CartesiaConfig): AsyncIterable<AudioChunk> {
    if (!this.connected && !config.apiKey && !process.env.CARTESIA_API_KEY) {
      yield* this.synthesizeConnected(text, config);
      return;
    }

    yield* this.synthesizeConnected(text, config);
  }

  private async *synthesizeConnected(
    text: string,
    config: CartesiaConfig,
  ): AsyncIterable<AudioChunk> {
    const effectiveConfig = this._config ? { ...this._config, ...config } : config;

    const apiKey = effectiveConfig.apiKey || process.env.CARTESIA_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Cartesia API key is required. Set CARTESIA_API_KEY or pass apiKey in config.',
      );
    }

    const voiceId = effectiveConfig.voiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091';
    const modelId = effectiveConfig.modelId || 'sonic-english';
    const outputFormat = effectiveConfig.outputFormat || {
      container: 'raw',
      encoding: 'pcm_s16le',
      sampleRate: 8000,
    };
    const language = effectiveConfig.language || 'en';
    const speed = effectiveConfig.speed || 'normal';
    const emotion = effectiveConfig.emotion || ['positivity'];

    const url = `https://${this.options.apiUrl}/tts/bytes`;

    const requestBody: CartesiaTTSRequest = {
      modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      outputFormat,
      language,
      speed,
      emotion,
    };

    this.abortController = new AbortController();
    const startTime = performance.now();
    let firstByteReceived = false;

    let encoding: AudioChunk['encoding'];
    let sampleRate = outputFormat.sampleRate;

    switch (outputFormat.encoding) {
      case 'pcm_mulaw':
        encoding = 'mulaw';
        break;
      case 'pcm_f32le':
        encoding = 'pcm';
        sampleRate = outputFormat.sampleRate;
        break;
      default:
        encoding = 'linear16';
        sampleRate = outputFormat.sampleRate;
        break;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `Cartesia TTS error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
        );
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No response body from Cartesia');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!firstByteReceived) {
          this.lastLatency = performance.now() - startTime;
          firstByteReceived = true;
        }

        const chunk: AudioChunk = {
          buffer: Buffer.from(value),
          sampleRate,
          encoding,
          channels: 1,
          timestamp: Date.now(),
        };

        yield TTSProviderInterface.formatAudioForTwilio(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getLastFirstByteLatency(): number | null {
    return this.lastLatency;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    this.cancel();
    this.connected = false;
    this._config = null;
  }
}

export function createCartesiaTTSProvider(options?: CartesiaTTSOptions): CartesiaTTSProvider {
  return new CartesiaTTSProvider(options);
}
