import type { AudioChunk } from '@voice-agent-kit/core';

import type { TTSProvider, DeepgramTTSConfig } from '../interface.js';
import { TTSProviderInterface } from '../interface.js';

export interface DeepgramTTSOptions {
  apiUrl?: string;
  version?: string;
}

interface DeepgramTTSRequest {
  text: string;
  voice: string;
  model: string;
  encoding: string;
  sample_rate: number;
  container: string;
}

export class DeepgramTTSProvider implements TTSProvider {
  readonly name = 'deepgram';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;
  
  private options: DeepgramTTSOptions;
  private lastLatency: number | null = null;
  private abortController: AbortController | null = null;

  constructor(options: DeepgramTTSOptions = {}) {
    this.options = {
      apiUrl: 'api.deepgram.com',
      version: 'v1',
      ...options,
    };
  }

  async *synthesize(text: string, config: DeepgramTTSConfig): AsyncIterable<AudioChunk> {
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;
    
    if (!apiKey) {
      throw new Error('Deepgram API key is required');
    }

    const voice = config.voice || 'asteria';
    const model = config.model || 'aura';
    const encoding = config.encoding || 'mulaw';
    const sampleRate = config.sampleRate || 8000;
    const container = config.container || 'none';

    const url = `https://${this.options.apiUrl}/${this.options.version}/speak?model=${model}&voice=${voice}`;
    
    const requestBody: DeepgramTTSRequest = {
      text,
      voice,
      model,
      encoding,
      sample_rate: sampleRate,
      container,
    };

    this.abortController = new AbortController();
    const startTime = performance.now();
    let firstByteReceived = false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Deepgram TTS error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      
      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {break;}

        if (!firstByteReceived) {
          this.lastLatency = performance.now() - startTime;
          firstByteReceived = true;
        }

        const chunk: AudioChunk = {
          buffer: Buffer.from(value),
          sampleRate,
          encoding: encoding as 'mulaw' | 'linear16' | 'pcm',
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
}

export function createDeepgramTTSProvider(options?: DeepgramTTSOptions): DeepgramTTSProvider {
  return new DeepgramTTSProvider(options);
}
