import type { AudioChunk, Transport, TransportSessionMetadata } from '@reaatech/voice-agent-core';
import debugFactory from 'debug';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import { decodeOpus, encodeOpus, isOpusAvailable } from './codec/opus.js';
import { interleaveToMono, monoToInterleave, resample } from './codec/resampler.js';

const debug = debugFactory('voice:webrtc:transport');

export interface WebRTCTransportConfig {
  /** Target output sample rate for the STT pipeline (default 16000) */
  outputSampleRate: number;
  /** Target output channels for the STT pipeline (default 1) */
  outputChannels: number;
  /** Barge-in configuration */
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
  /** Opus frame size in ms (default 20) */
  frameDurationMs: number;
}

const DEFAULT_CONFIG: WebRTCTransportConfig = {
  outputSampleRate: 16000,
  outputChannels: 1,
  bargeInEnabled: true,
  minSpeechDuration: 300,
  confidenceThreshold: 0.7,
  silenceThreshold: 0.3,
  frameDurationMs: 20,
};

interface WebRTCStartMessage {
  type: 'start';
  sampleRate: number;
  channels: number;
}

interface WebRTCAudioMessage {
  type: 'audio';
  data: string; // base64 Opus
}

interface WebRTCStopMessage {
  type: 'stop';
}

type WebRTCIncomingMessage = WebRTCStartMessage | WebRTCAudioMessage | WebRTCStopMessage;

interface WebRTCOutboundAudioMessage {
  type: 'audio';
  data: string; // base64 Opus
}

interface WebRTCOutboundClearMessage {
  type: 'clear';
}

interface WebRTCOutboundTranscriptMessage {
  type: 'transcript';
  text: string;
  isFinal: boolean;
  confidence?: number;
}

export class WebRTCTransport extends EventEmitter implements Transport {
  readonly name = 'webrtc' as const;

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  isConnected = false;

  private inputSampleRate = 48000;
  private inputChannels = 2;

  private readonly outputSampleRate: number;
  private readonly outputChannels: number;
  private readonly bargeInEnabled: boolean;
  private readonly minSpeechDuration: number;
  private readonly confidenceThreshold: number;
  private readonly silenceThreshold: number;

  private isTTSPlaying = false;
  private speechStartTime: number | null = null;
  private isBargeInTriggered = false;

  constructor(config: Partial<WebRTCTransportConfig> = {}) {
    super();
    const resolved = { ...DEFAULT_CONFIG, ...config };
    this.outputSampleRate = resolved.outputSampleRate;
    this.outputChannels = resolved.outputChannels;
    this.bargeInEnabled = resolved.bargeInEnabled;
    this.minSpeechDuration = resolved.minSpeechDuration;
    this.confidenceThreshold = resolved.confidenceThreshold;
    this.silenceThreshold = resolved.silenceThreshold;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  acceptConnection(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = ws;

      if (ws.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        this.emit('connected');
        resolve();
      }

      ws.on('open', () => {
        this.isConnected = true;
        this.emit('connected');
        resolve();
      });

      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        this.handleMessage(buffer);
      });

      ws.on('close', () => {
        this.isConnected = false;
        const endedSessionId = this.sessionId;
        this.sessionId = null;
        this.emit('disconnected');
        if (endedSessionId) {
          this.emit('session:end', { sessionId: endedSessionId });
        }
      });

      ws.on('error', (error: Error) => {
        this.emit('error', error);
        reject(error);
      });

      ws.on('ping', () => {
        ws.pong();
      });
    });
  }

  sendAudio(chunk: AudioChunk): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    let pcmBuffer: Buffer;

    // Convert input audio to Int16 PCM at the desired output rate/channels for encoding
    if (chunk.encoding === 'opus') {
      // Already Opus — send as-is
      const message: WebRTCOutboundAudioMessage = {
        type: 'audio',
        data: chunk.buffer.toString('base64'),
      };
      this.ws.send(JSON.stringify(message));
      return;
    }

    // Convert from various PCM formats to Int16
    pcmBuffer = this.normalizeToInt16(chunk);

    // Resample to input sample rate if needed
    if (chunk.sampleRate !== this.inputSampleRate) {
      pcmBuffer = resample(pcmBuffer, chunk.sampleRate, this.inputSampleRate, chunk.channels);
    }

    // Convert to match input channels (the browser expects stereo typically)
    if (chunk.channels === 1 && this.inputChannels === 2) {
      pcmBuffer = monoToInterleave(pcmBuffer);
    } else if (chunk.channels === 2 && this.inputChannels === 1) {
      pcmBuffer = interleaveToMono(pcmBuffer);
    }

    // Encode to Opus
    let opusBuffer: Buffer;
    try {
      opusBuffer = encodeOpus(pcmBuffer, this.inputSampleRate, this.inputChannels);
    } catch (err) {
      debug('Opus encode failed: %o', err);
      return;
    }

    const message: WebRTCOutboundAudioMessage = {
      type: 'audio',
      data: opusBuffer.toString('base64'),
    };

    this.ws.send(JSON.stringify(message));
  }

  async clearAudio(): Promise<void> {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const message: WebRTCOutboundClearMessage = { type: 'clear' };
    this.ws.send(JSON.stringify(message));
    this.isTTSPlaying = false;
    this.resetBargeInState();
  }

  /**
   * Send a transcript update to the browser for real-time captions.
   */
  sendTranscript(text: string, isFinal: boolean, confidence?: number): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const message: WebRTCOutboundTranscriptMessage = {
      type: 'transcript',
      text,
      isFinal,
      ...(confidence !== undefined ? { confidence } : {}),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Feed an interim transcript from the STT pipeline for barge-in detection.
   */
  onInterimTranscript(transcript: string, confidence: number): void {
    if (!this.bargeInEnabled || !this.isTTSPlaying || this.isBargeInTriggered) {
      return;
    }

    if (confidence < this.confidenceThreshold) {
      return;
    }

    if (transcript && transcript.trim().length > 0) {
      if (this.speechStartTime === null) {
        this.speechStartTime = Date.now();
      } else {
        const speechDuration = Date.now() - this.speechStartTime;
        if (speechDuration >= this.minSpeechDuration) {
          this.triggerBargeIn();
        }
      }
    } else {
      this.speechStartTime = null;
    }
  }

  setTTSPlaying(playing: boolean): void {
    this.isTTSPlaying = playing;
    if (!playing) {
      this.resetBargeInState();
    }
  }

  isTTSActive(): boolean {
    return this.isTTSPlaying;
  }

  isBargeInEnabled(): boolean {
    return this.bargeInEnabled;
  }

  isOpusAvailable(): boolean {
    return isOpusAvailable();
  }

  async close(): Promise<void> {
    this.isConnected = false;
    this.sessionId = null;
    this.isTTSPlaying = false;
    this.resetBargeInState();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private triggerBargeIn(): void {
    this.isBargeInTriggered = true;
    this.isTTSPlaying = false;

    debug('Barge-in detected for session %s', this.sessionId);

    this.emit('barge-in:detected', {
      sessionId: this.sessionId,
      timestamp: Date.now(),
    });

    // Send clear to browser
    if (this.isConnected && this.ws) {
      const message: WebRTCOutboundClearMessage = { type: 'clear' };
      this.ws.send(JSON.stringify(message));
    }
  }

  private resetBargeInState(): void {
    this.speechStartTime = null;
    this.isBargeInTriggered = false;
  }

  private handleMessage(data: Buffer): void {
    let message: WebRTCIncomingMessage;

    try {
      message = JSON.parse(data.toString()) as WebRTCIncomingMessage;
    } catch (err) {
      this.emit('error', new Error(`Invalid WebRTC message: ${String(err)}`));
      return;
    }

    switch (message.type) {
      case 'start':
        this.handleStart(message as WebRTCStartMessage);
        break;
      case 'audio':
        this.handleAudio(message as WebRTCAudioMessage);
        break;
      case 'stop':
        this.handleStop();
        break;
      default:
        debug('Unknown WebRTC message type: %s', (message as { type: string }).type);
    }
  }

  private handleStart(message: WebRTCStartMessage): void {
    this.inputSampleRate = message.sampleRate;
    this.inputChannels = message.channels;
    this.sessionId = `webrtc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    debug(
      'WebRTC session %s started: %dHz, %d channels',
      this.sessionId,
      this.inputSampleRate,
      this.inputChannels,
    );

    const metadata: TransportSessionMetadata = {
      sessionId: this.sessionId,
      codec: 'opus',
      sampleRate: this.inputSampleRate,
      customParameters: {
        channels: String(this.inputChannels),
        transport: 'webrtc',
      },
    };

    this.emit('session:start', metadata);
  }

  private handleAudio(message: WebRTCAudioMessage): void {
    const opusBuffer = Buffer.from(message.data, 'base64');

    if (opusBuffer.length === 0) {
      return;
    }

    let pcmBuffer: Buffer;

    try {
      pcmBuffer = decodeOpus(opusBuffer, this.inputSampleRate, this.inputChannels);
    } catch (err) {
      debug('Opus decode failed: %o', err);
      this.emit('error', new Error(`Opus decode failed: ${String(err)}`));
      return;
    }

    if (pcmBuffer.length === 0) {
      return;
    }

    let channelCount = this.inputChannels;
    let sampleRate = this.inputSampleRate;

    // Convert stereo → mono if needed
    if (channelCount === 2 && this.outputChannels === 1) {
      pcmBuffer = interleaveToMono(pcmBuffer);
      channelCount = 1;
    } else if (channelCount === 1 && this.outputChannels === 2) {
      pcmBuffer = monoToInterleave(pcmBuffer);
      channelCount = 2;
    }

    // Resample to output sample rate
    if (sampleRate !== this.outputSampleRate) {
      pcmBuffer = resample(pcmBuffer, sampleRate, this.outputSampleRate, channelCount);
      sampleRate = this.outputSampleRate;
    }

    // Voice activity detection for barge-in
    if (this.bargeInEnabled && this.isTTSPlaying && !this.isBargeInTriggered) {
      const rms = this.calculateRMS(pcmBuffer);
      if (rms > this.silenceThreshold) {
        if (this.speechStartTime === null) {
          this.speechStartTime = Date.now();
        } else if (Date.now() - this.speechStartTime >= this.minSpeechDuration) {
          this.triggerBargeIn();
          return;
        }
      } else {
        this.speechStartTime = null;
      }
    }

    const chunk: AudioChunk = {
      buffer: pcmBuffer,
      sampleRate,
      encoding: 'linear16',
      channels: channelCount,
      timestamp: Date.now(),
    };

    this.emit('audio:received', chunk);
  }

  private handleStop(): void {
    debug('WebRTC session %s stopped by client', this.sessionId);

    const endedSessionId = this.sessionId;
    this.sessionId = null;
    this.isTTSPlaying = false;
    this.resetBargeInState();

    if (endedSessionId) {
      this.emit('session:end', { sessionId: endedSessionId });
    }
  }

  /**
   * Normalize various PCM encodings to Int16.
   */
  private normalizeToInt16(chunk: AudioChunk): Buffer {
    if (chunk.encoding === 'mulaw') {
      return this.mulawToInt16(chunk.buffer);
    }

    // linear16 and pcm are already Int16 LE
    return chunk.buffer;
  }

  /**
   * μ-law to 16-bit signed linear PCM using a lookup table.
   */
  private mulawToInt16(buffer: Buffer): Buffer {
    const output = Buffer.allocUnsafe(buffer.length * 2);

    for (let i = 0; i < buffer.length; i++) {
      const sample = mulawToLinear16(buffer.readUInt8(i));
      output.writeInt16LE(sample, i * 2);
    }

    return output;
  }

  /**
   * Calculate RMS amplitude of a PCM Int16 buffer.
   * Returns a value between 0 and 1 (normalised).
   */
  private calculateRMS(buffer: Buffer): number {
    if (buffer.length === 0) return 0;

    const sampleCount = Math.floor(buffer.length / 2);
    let sumSquares = 0;

    for (let i = 0; i < sampleCount; i++) {
      const s = buffer.readInt16LE(i * 2) / 32768;
      sumSquares += s * s;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }
}

// μ-law decoding lookup table
function buildMulawTable(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const ulaw = ~i & 0xff;
    const sign = ulaw & 0x80 ? -1 : 1;
    const exponent = (ulaw >> 4) & 0x07;
    const mantissa = ulaw & 0x0f;
    let sample = ((mantissa << 3) | 0x84) << (exponent + 1);
    sample -= 0x84 << 4;
    sample -= 8;
    sample = sign === -1 ? -sample : sample;
    table[i] = Math.max(-32768, Math.min(32767, sample));
  }
  return table;
}

const MULAW_TABLE = buildMulawTable();

function mulawToLinear16(ulaw: number): number {
  return MULAW_TABLE[ulaw] ?? 0;
}
