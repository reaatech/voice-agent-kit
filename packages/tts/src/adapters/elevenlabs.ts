import type { AudioChunk } from '@reaatech/voice-agent-core';

import type { ElevenLabsConfig, TTSProvider } from '../interface.js';
import { TTSProviderInterface } from '../interface.js';

export interface ElevenLabsTTSOptions {
  apiUrl?: string;
}

interface ElevenLabsTTSRequest {
  text: string;
  model_id: string;
  voice_settings?: ElevenLabsConfig['voiceSettings'];
}

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;

  private options: ElevenLabsTTSOptions;
  private lastLatency: number | null = null;
  private abortController: AbortController | null = null;
  private connected = false;
  private _config: ElevenLabsConfig | null = null;

  constructor(options: ElevenLabsTTSOptions = {}) {
    this.options = {
      apiUrl: 'api.elevenlabs.io',
      ...options,
    };
  }

  async connect(config: ElevenLabsConfig): Promise<void> {
    const apiKey = config.apiKey || process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      throw new Error(
        'ElevenLabs API key is required. Set ELEVENLABS_API_KEY or pass apiKey in config.',
      );
    }

    this._config = { ...config, apiKey };
    this.connected = true;
  }

  async *synthesize(text: string, config: ElevenLabsConfig): AsyncIterable<AudioChunk> {
    if (!this.connected && !config.apiKey && !process.env.ELEVENLABS_API_KEY) {
      yield* this.synthesizeConnected(text, config);
      return;
    }

    yield* this.synthesizeConnected(text, config);
  }

  private async *synthesizeConnected(
    text: string,
    config: ElevenLabsConfig,
  ): AsyncIterable<AudioChunk> {
    const effectiveConfig = this._config ? { ...this._config, ...config } : config;

    const apiKey = effectiveConfig.apiKey || process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      throw new Error(
        'ElevenLabs API key is required. Set ELEVENLABS_API_KEY or pass apiKey in config.',
      );
    }

    const voiceId = effectiveConfig.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = effectiveConfig.modelId || 'eleven_flash_v2_5';
    const optimizeStreamingLatency = effectiveConfig.optimizeStreamingLatency ?? 4;
    const outputFormat = effectiveConfig.outputFormat || 'mulaw_8000';

    const url = `https://${this.options.apiUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

    const queryParams = new URLSearchParams({
      optimize_streaming_latency: optimizeStreamingLatency.toString(),
      output_format: outputFormat,
    });

    const requestBody: ElevenLabsTTSRequest = {
      text,
      model_id: modelId,
    };

    if (effectiveConfig.voiceSettings) {
      requestBody.voice_settings = effectiveConfig.voiceSettings;
    }

    this.abortController = new AbortController();
    const startTime = performance.now();
    let firstByteReceived = false;

    let sampleRate = 8000;
    let encoding: AudioChunk['encoding'] = 'mulaw';

    switch (outputFormat) {
      case 'pcm_16000':
        sampleRate = 16000;
        encoding = 'linear16';
        break;
      case 'pcm_22050':
        sampleRate = 22050;
        encoding = 'linear16';
        break;
      case 'pcm_24000':
        sampleRate = 24000;
        encoding = 'linear16';
        break;
      default:
        sampleRate = 8000;
        encoding = 'mulaw';
        break;
    }

    try {
      const response = await fetch(`${url}?${queryParams.toString()}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: outputFormat === 'mulaw_8000' ? 'audio/mulaw' : 'audio/pcm',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `ElevenLabs TTS error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
        );
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No response body from ElevenLabs');
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

export function createElevenLabsTTSProvider(options?: ElevenLabsTTSOptions): ElevenLabsTTSProvider {
  return new ElevenLabsTTSProvider(options);
}
