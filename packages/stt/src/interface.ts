import type { AudioChunk, Utterance, STTConfig } from '@voice-agent-kit/core';

export interface STTProviderEvents {
  utterance: (utterance: Utterance) => void;
  endOfSpeech: () => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
}

export interface DeepgramConfig extends STTConfig {
  model?: 'nova-2' | 'nova' | 'enhanced' | 'base';
  language?: string;
  smartFormat?: boolean;
  punctuation?: boolean;
  profanityFilter?: boolean;
  interimResults?: boolean;
  vadEvents?: boolean;
  endpointing?: number | false;
  silenceThreshold?: number;
}

export interface AWSTranscribeConfig extends STTConfig {
  region: string;
  languageCode?: string;
  vocabularyName?: string;
  showSpeakerLabels?: boolean;
  maxSpeakerLabels?: number;
  enableChannelIdentification?: boolean;
  numberOfChannels?: number;
}

export interface GoogleCloudSTTConfig extends STTConfig {
  projectId: string;
  languageCode?: string;
  alternativeLanguageCodes?: string[];
  model?: 'latest_long' | 'latest_short' | 'phone_call' | 'video';
  useEnhanced?: boolean;
  profanityFilter?: boolean;
  enableAutomaticPunctuation?: boolean;
  enableWordTimeOffsets?: boolean;
  maxAlternatives?: number;
  singleUtterance?: boolean;
  interimResults?: boolean;
}

export interface STTProvider {
  readonly name: string;
  connect(config: DeepgramConfig | AWSTranscribeConfig | GoogleCloudSTTConfig): Promise<void>;
  streamAudio(chunk: AudioChunk): void;
  onUtterance(cb: (utterance: Utterance) => void): void;
  onEndOfSpeech(cb: () => void): void;
  onError(cb: (error: Error) => void): void;
  close(): Promise<void>;
  isConnected(): boolean;
}

export class STTProviderInterface {
  static validateAudioChunk(chunk: AudioChunk): boolean {
    return Buffer.isBuffer(chunk.buffer) && 
           chunk.buffer.length > 0 && 
           typeof chunk.sampleRate === 'number' && 
           chunk.sampleRate > 0;
  }

  static convertAudioFormat(
    chunk: AudioChunk, 
    targetSampleRate: number, 
    targetEncoding: 'mulaw' | 'linear16' | 'pcm'
  ): AudioChunk {
    let convertedBuffer = chunk.buffer;
    
    if (chunk.encoding === 'mulaw' && targetEncoding === 'linear16') {
      convertedBuffer = this.mulawToLinear16(chunk.buffer);
    } else if (chunk.encoding === 'linear16' && targetEncoding === 'mulaw') {
      convertedBuffer = this.linear16ToMulaw(chunk.buffer);
    }
    
    if (chunk.sampleRate !== targetSampleRate) {
      const bytesPerSample = targetEncoding === 'mulaw' ? 1 : 2;
      convertedBuffer = this.resample(convertedBuffer, chunk.sampleRate, targetSampleRate, bytesPerSample);
    }
    
    return {
      ...chunk,
      buffer: convertedBuffer,
      sampleRate: targetSampleRate,
      encoding: targetEncoding,
    };
  }

  public static mulawToLinear16(mulawBuffer: Buffer): Buffer {
    const linearBuffer = Buffer.alloc(mulawBuffer.length * 2);
    for (let i = 0; i < mulawBuffer.length; i++) {
      const byte = mulawBuffer[i];
      if (byte === undefined) {continue;}
      const ulaw = ~byte;
      let t = ((ulaw & 0x0f) << 4) + 0x84;
      t <<= ((ulaw & 0x70) >> 4) + 1;
      const sample = (ulaw & 0x80) ? (0x84 - t) : (t - 0x84);
      linearBuffer.writeInt16LE(sample, i * 2);
    }
    return linearBuffer;
  }

  private static linear16ToMulaw(linearBuffer: Buffer): Buffer {
    const mulawBuffer = Buffer.alloc(linearBuffer.length / 2);
    for (let i = 0; i < mulawBuffer.length; i++) {
      let sample = linearBuffer.readInt16LE(i * 2);
      const sign = (sample < 0) ? 1 : 0;
      sample = Math.abs(sample);
      
      if (sample > 8159) {sample = 8159;}
      sample += 132;
      
      let exponent = 0;
      while (sample > 255) {
        sample >>= 1;
        exponent++;
      }
      
      const mantissa = (sample >> 4) & 0x0f;
      mulawBuffer[i] = ~(sign << 7 | exponent << 4 | mantissa);
    }
    return mulawBuffer;
  }

  private static resample(buffer: Buffer, fromRate: number, toRate: number, bytesPerSample: number): Buffer {
    if (fromRate === toRate) {return buffer;}

    const ratio = fromRate / toRate;
    const srcSamples = Math.floor(buffer.length / bytesPerSample);
    const newSamples = Math.floor(srcSamples / ratio);
    const newBuffer = Buffer.alloc(newSamples * bytesPerSample);

    for (let i = 0; i < newSamples; i++) {
      const srcIndex = Math.floor(i * ratio);
      if (srcIndex < srcSamples) {
        buffer.copy(newBuffer, i * bytesPerSample, srcIndex * bytesPerSample, srcIndex * bytesPerSample + bytesPerSample);
      }
    }

    return newBuffer;
  }
}
