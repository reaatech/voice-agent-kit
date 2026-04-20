import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { AudioChunk } from '@voice-agent-kit/core';

import type { TTSProvider, GoogleCloudTTSConfig } from '../interface.js';
import { TTSProviderInterface } from '../interface.js';


export interface GoogleCloudTTSOptions {
  projectId?: string;
  keyFilename?: string;
}

export class GoogleCloudTTSProvider implements TTSProvider {
  readonly name = 'google-cloud-tts';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;
  
  private client: TextToSpeechClient | null = null;
  private options: GoogleCloudTTSOptions;
  private lastLatency: number | null = null;
  private abortController: AbortController | null = null;

  constructor(options: GoogleCloudTTSOptions = {}) {
    this.options = {
      ...options,
    };
  }

  private async getClient(config: GoogleCloudTTSConfig): Promise<TextToSpeechClient> {
    if (this.client) {
      return this.client;
    }

    const apiKey = config.apiKey;
    const projectId = config.projectId || this.options.projectId;
    const keyFilename = this.options.keyFilename;

    if (!apiKey && !keyFilename && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('Google Cloud credentials are required');
    }

    this.client = new TextToSpeechClient({
      projectId,
      keyFilename,
      credentials: apiKey ? {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: apiKey.replace(/\\n/g, '\n'),
      } : undefined,
    });

    return this.client;
  }

  async *synthesize(text: string, config: GoogleCloudTTSConfig): AsyncIterable<AudioChunk> {
    const client = await this.getClient(config);
    
    const voiceName = config.voiceName || 'en-US-Standard-A';
    const languageCode = config.languageCode || 'en-US';
    const ssmlGender = config.ssmlGender || 'FEMALE';
    const audioEncoding = config.audioEncoding || 'LINEAR16';
    const sampleRateHertz = config.sampleRateHertz || 8000;
    const speakingRate = config.speakingRate || 1.0;
    const pitch = config.pitch || 0;
    const volumeGainDb = config.volumeGainDb || 0;

    const request = {
      input: { text },
      voice: {
        languageCode,
        name: voiceName,
        ssmlGender,
      },
      audioConfig: {
        audioEncoding,
        sampleRateHertz,
        speakingRate,
        pitch,
        volumeGainDb,
      },
    };

    this.abortController = new AbortController();
    const startTime = performance.now();
    let firstByteReceived = false;

    try {
      const [response] = await client.synthesizeSpeech(request);

      if (!response.audioContent) {
        throw new Error('No audio content in response');
      }

      // Google Cloud TTS returns base64-encoded audio
      const audioBuffer = Buffer.from(response.audioContent as Buffer);
      
      // Split into chunks for streaming (20ms frames at 8kHz = 160 samples = 320 bytes for 16-bit)
      const chunkSize = Math.floor((sampleRateHertz / 1000) * 20 * 2); // 20ms of 16-bit audio
      let offset = 0;

      while (offset < audioBuffer.length) {
        if (this.abortController?.signal.aborted) {
          return;
        }

        const end = Math.min(offset + chunkSize, audioBuffer.length);
        const chunkBuffer = audioBuffer.slice(offset, end);

        if (!firstByteReceived) {
          this.lastLatency = performance.now() - startTime;
          firstByteReceived = true;
        }

        const chunk: AudioChunk = {
          buffer: chunkBuffer,
          sampleRate: sampleRateHertz,
          encoding: audioEncoding === 'LINEAR16' ? 'linear16' : 
                    audioEncoding === 'MULAW' ? 'mulaw' : 'pcm',
          channels: 1,
          timestamp: Date.now(),
        };

        yield TTSProviderInterface.formatAudioForTwilio(chunk);
        
        offset += chunkSize;
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

export function createGoogleCloudTTSProvider(options?: GoogleCloudTTSOptions): GoogleCloudTTSProvider {
  return new GoogleCloudTTSProvider(options);
}
