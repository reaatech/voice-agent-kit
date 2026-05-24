import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';

import type { OpenAIWhisperConfig, STTProvider } from '../interface.js';
import { STTProviderInterface } from '../interface.js';

export interface OpenAIWhisperOptions {
  apiUrl?: string;
  silenceTimeoutMs?: number;
  interimIntervalMs?: number;
  minAudioSizeBytes?: number;
}

export class OpenAIWhisperSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'openai-whisper';

  private connected = false;
  private _config: OpenAIWhisperConfig | null = null;
  private options: Required<OpenAIWhisperOptions>;
  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private interimTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightRequest = false;

  private static readonly DEFAULT_SILENCE_MS = 800;
  private static readonly DEFAULT_INTERIM_MS = 600;
  private static readonly DEFAULT_MIN_AUDIO = 1600;

  constructor(options: OpenAIWhisperOptions = {}) {
    super();
    this.options = {
      apiUrl: options.apiUrl || 'https://api.openai.com/v1/audio/transcriptions',
      silenceTimeoutMs: options.silenceTimeoutMs ?? OpenAIWhisperSTTProvider.DEFAULT_SILENCE_MS,
      interimIntervalMs: options.interimIntervalMs ?? OpenAIWhisperSTTProvider.DEFAULT_INTERIM_MS,
      minAudioSizeBytes: options.minAudioSizeBytes ?? OpenAIWhisperSTTProvider.DEFAULT_MIN_AUDIO,
    };
  }

  async connect(config: OpenAIWhisperConfig): Promise<void> {
    this._config = config;
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.connected = true;
    this.emit('connected');
  }

  streamAudio(chunk: AudioChunk): void {
    if (!STTProviderInterface.validateAudioChunk(chunk)) {
      this.emit('error', new Error('Invalid audio chunk'));
      return;
    }

    if (!this.connected) {
      return;
    }

    const converted = STTProviderInterface.convertAudioFormat(chunk, 16000, 'linear16');
    this.audioBuffer.push(converted.buffer);
    this.resetSilenceTimer();
    this.startInterimTimer();
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
    this.stopInterimTimer();
    this.clearSilenceTimer();

    if (this.audioBuffer.length > 0 && this._config) {
      await this.flushAudioAndTranscribe(true);
    }

    this.audioBuffer = [];
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.onSilenceDetected();
    }, this.options.silenceTimeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private startInterimTimer(): void {
    if (this.interimTimer) {
      return;
    }
    this.interimTimer = setInterval(() => {
      if (!this.inFlightRequest && this.audioBuffer.length > 0 && this._config) {
        this.flushAudioAndTranscribe(false).catch(() => {});
      }
    }, this.options.interimIntervalMs);
  }

  private stopInterimTimer(): void {
    if (this.interimTimer) {
      clearInterval(this.interimTimer);
      this.interimTimer = null;
    }
  }

  private onSilenceDetected(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    const totalBytes = this.audioBuffer.reduce((sum, b) => sum + b.length, 0);
    if (totalBytes < this.options.minAudioSizeBytes) {
      this.resetSilenceTimer();
      return;
    }

    this.flushAudioAndTranscribe(true).catch(() => {});
  }

  private async flushAudioAndTranscribe(isFinal: boolean): Promise<void> {
    if (this.inFlightRequest || this.audioBuffer.length === 0 || !this._config) {
      return;
    }

    this.inFlightRequest = true;
    const buffers = this.audioBuffer.splice(0);
    if (isFinal) {
      this.clearSilenceTimer();
      this.stopInterimTimer();
    }

    try {
      const combined = Buffer.concat(buffers);

      if (combined.length < this.options.minAudioSizeBytes) {
        this.inFlightRequest = false;
        return;
      }

      const wavBuffer = this.createWavBuffer(combined, 16000, 1);
      const transcript = await this.sendTranscriptionRequest(wavBuffer);

      if (transcript?.trim()) {
        const utterance: Utterance = {
          transcript,
          confidence: 0.9,
          isFinal,
          timestamp: Date.now(),
        };
        this.emit('utterance', utterance);

        if (isFinal) {
          this.emit('endOfSpeech');
        }
      }
    } catch (error) {
      if (isFinal || this.connected) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.inFlightRequest = false;
    }
  }

  private async sendTranscriptionRequest(wavBuffer: Buffer): Promise<string> {
    const config = this._config;
    if (!config) {
      throw new Error('Not configured');
    }

    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const boundary = `----FormBoundary${Date.now()}`;
    const filename = `audio_${Date.now()}.wav`;

    const parts: Buffer[] = [];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
        'utf-8',
      ),
    );
    parts.push(wavBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}\r\n`, 'utf-8'));
    parts.push(
      Buffer.from(
        `Content-Disposition: form-data; name="model"\r\n\r\n${config.model || 'whisper-1'}\r\n`,
        'utf-8',
      ),
    );
    parts.push(Buffer.from(`--${boundary}\r\n`, 'utf-8'));

    if (config.language) {
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="language"\r\n\r\n${config.language}\r\n`,
          'utf-8',
        ),
      );
      parts.push(Buffer.from(`--${boundary}\r\n`, 'utf-8'));
    }

    parts.push(
      Buffer.from(
        `Content-Disposition: form-data; name="response_format"\r\n\r\n${config.responseFormat || 'json'}\r\n`,
        'utf-8',
      ),
    );
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));

    const body = Buffer.concat(parts);

    const response = await fetch(this.options.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI Whisper API error ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as { text: string };
    return result.text || '';
  }

  private createWavBuffer(pcmData: Buffer, sampleRate: number, numChannels: number): Buffer {
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const headerSize = 44;

    const buffer = Buffer.alloc(headerSize + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    pcmData.copy(buffer, headerSize);

    return buffer;
  }
}

export function createOpenAIWhisperSTTProvider(
  options?: OpenAIWhisperOptions,
): OpenAIWhisperSTTProvider {
  return new OpenAIWhisperSTTProvider(options);
}
