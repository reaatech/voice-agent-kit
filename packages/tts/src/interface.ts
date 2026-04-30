import type { AudioChunk, TTSConfig } from '@reaatech/voice-agent-core';

export interface DeepgramTTSConfig extends TTSConfig {
  model?: 'aura';
  voice?: string;
  encoding?: 'mulaw' | 'linear16' | 'pcm';
  sampleRate?: number;
  container?: 'none' | 'wav';
}

export interface AWSPollyConfig extends TTSConfig {
  region: string;
  voiceId?: string;
  engine?: 'standard' | 'neural';
  languageCode?: string;
  sampleRate?: number;
  textType?: 'text' | 'ssml';
}

export interface GoogleCloudTTSConfig extends TTSConfig {
  projectId: string;
  voiceName?: string;
  languageCode?: string;
  ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  audioEncoding?: 'MP3' | 'LINEAR16' | 'OGG_OPUS' | 'MULAW' | 'ALAW';
  sampleRateHertz?: number;
  speakingRate?: number;
  pitch?: number;
  volumeGainDb?: number;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(
    text: string,
    config: DeepgramTTSConfig | AWSPollyConfig | GoogleCloudTTSConfig,
  ): AsyncIterable<AudioChunk>;
  readonly supportsStreaming: boolean;
  readonly firstByteLatencyMs: number | null;
  cancel(): void;
  connect?(config: unknown): Promise<void>;
}

// biome-ignore lint/complexity/noStaticOnlyClass: utility class providing TTS format helpers
export class TTSProviderInterface {
  static formatAudioForTwilio(chunk: AudioChunk): AudioChunk {
    if (chunk.encoding === 'mulaw' && chunk.sampleRate === 8000) {
      return chunk;
    }

    let buffer = chunk.buffer;

    if (chunk.encoding !== 'mulaw') {
      buffer = TTSProviderInterface.convertToMulaw(buffer, chunk.encoding, chunk.sampleRate);
    }

    if (chunk.sampleRate !== 8000) {
      buffer = TTSProviderInterface.resampleTo8kHz(buffer, chunk.sampleRate);
    }

    return {
      ...chunk,
      buffer,
      sampleRate: 8000,
      encoding: 'mulaw',
    };
  }

  static createSilenceChunk(durationMs: number, sampleRate = 8000): AudioChunk {
    const bytesPerSample = 1;
    const bufferSize = Math.ceil((sampleRate / 1000) * durationMs * bytesPerSample);

    return {
      buffer: Buffer.alloc(bufferSize, 0x7f),
      sampleRate,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
  }

  static chunkTextForStreaming(text: string, maxChunkSize = 200): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const sentences = text.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += ` ${sentence}`;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private static convertToMulaw(buffer: Buffer, encoding: string, _sampleRate: number): Buffer {
    if (encoding === 'linear16') {
      const mulawBuffer = Buffer.alloc(buffer.length / 2);
      for (let i = 0; i < mulawBuffer.length; i++) {
        let sample = buffer.readInt16LE(i * 2);
        const sign = sample < 0 ? 1 : 0;
        sample = Math.abs(sample);

        if (sample > 8159) {
          sample = 8159;
        }
        sample += 132;

        let exponent = 0;
        while (sample > 255) {
          sample >>= 1;
          exponent++;
        }

        const mantissa = (sample >> 4) & 0x0f;
        mulawBuffer[i] = ~((sign << 7) | (exponent << 4) | mantissa);
      }
      return mulawBuffer;
    }

    return buffer;
  }

  private static resampleTo8kHz(buffer: Buffer, fromRate: number, bytesPerSample = 1): Buffer {
    if (fromRate === 8000) {
      return buffer;
    }

    const ratio = fromRate / 8000;
    const srcSamples = Math.floor(buffer.length / bytesPerSample);
    const newSamples = Math.floor(srcSamples / ratio);
    const newBuffer = Buffer.alloc(newSamples * bytesPerSample);

    for (let i = 0; i < newSamples; i++) {
      const srcIndex = Math.floor(i * ratio);
      if (srcIndex < srcSamples) {
        buffer.copy(
          newBuffer,
          i * bytesPerSample,
          srcIndex * bytesPerSample,
          srcIndex * bytesPerSample + bytesPerSample,
        );
      }
    }

    return newBuffer;
  }
}
