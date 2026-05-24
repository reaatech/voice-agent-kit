import type { AudioChunk, Transport, TransportSessionMetadata } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface VonageTransportConfig {
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
  appId?: string;
  privateKey?: string;
}

interface VonageWebSocketConnectedMessage {
  event: 'websocket:connected';
  conversation_uuid?: string;
  uuid?: string;
}

interface VonageWebSocketDisconnectedMessage {
  event: 'websocket:disconnected';
  conversation_uuid?: string;
  uuid?: string;
}

interface VonageSpeechMessage {
  speech: {
    results: Array<{
      text: string;
      confidence: number;
    }>;
  };
}

interface VonageDTMFMessage {
  dtmf: {
    digit: string;
    timed_out?: boolean;
  };
}

type VonageControlMessage =
  | VonageWebSocketConnectedMessage
  | VonageWebSocketDisconnectedMessage
  | VonageSpeechMessage
  | VonageDTMFMessage;

export interface BargeInEvent {
  sessionId: string | null;
  timestamp: number;
}

export class VonageTransport extends EventEmitter implements Transport {
  readonly name = 'vonage' as const;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  isConnected = false;
  private isTTSPlaying = false;

  private readonly bargeInEnabled: boolean;
  private readonly minSpeechDuration: number;
  private readonly confidenceThreshold: number;
  private readonly silenceThreshold: number;

  private readonly appId: string | undefined;
  readonly privateKey: string | undefined;

  private speechStartTime: number | null = null;
  private isBargeInTriggered = false;

  constructor(config: Partial<VonageTransportConfig> = {}) {
    super();
    this.bargeInEnabled = config.bargeInEnabled ?? false;
    this.minSpeechDuration = config.minSpeechDuration ?? 300;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.silenceThreshold = config.silenceThreshold ?? 0.3;
    this.appId = config.appId;
    this.privateKey = config.privateKey;
  }

  getAppId(): string | undefined {
    return this.appId;
  }

  isBargeInEnabled(): boolean {
    return this.bargeInEnabled;
  }

  getBargeInThresholds(): {
    minSpeechDuration: number;
    confidenceThreshold: number;
    silenceThreshold: number;
  } {
    return {
      minSpeechDuration: this.minSpeechDuration,
      confidenceThreshold: this.confidenceThreshold,
      silenceThreshold: this.silenceThreshold,
    };
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
        if (Buffer.isBuffer(data)) {
          this.handleBinaryMessage(data);
        } else if (Array.isArray(data)) {
          this.handleBinaryMessage(Buffer.concat(data));
        } else if (typeof data === 'string') {
          this.handleTextMessage(data);
        } else {
          try {
            const text = new TextDecoder().decode(data as ArrayBuffer);
            this.handleTextMessage(text);
          } catch {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            this.handleBinaryMessage(buffer);
          }
        }
      });

      ws.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
      });

      ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      ws.on('ping', () => {
        ws.pong();
      });
    });
  }

  sendAudio(chunk: AudioChunk): void {
    if (!this.isConnected) {
      return;
    }

    const pcmBuffer =
      chunk.encoding === 'mulaw' ? VonageTransport.mulawToLinear16(chunk.buffer) : chunk.buffer;

    this.ws?.send(pcmBuffer);
  }

  async clearAudio(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    const silenceBuffer = Buffer.alloc(320, 0);

    this.ws?.send(silenceBuffer);
    this.isTTSPlaying = false;
    this.resetBargeInState();
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

  getSessionId(): string | null {
    return this.sessionId;
  }

  async close(): Promise<void> {
    this.isConnected = false;
    this.sessionId = null;
    this.isTTSPlaying = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

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

  private triggerBargeIn(): void {
    this.isBargeInTriggered = true;

    const event: BargeInEvent = {
      sessionId: this.sessionId,
      timestamp: Date.now(),
    };

    this.emit('barge-in:detected', event);

    this.isTTSPlaying = false;
  }

  resetBargeInState(): void {
    this.speechStartTime = null;
    this.isBargeInTriggered = false;
  }

  private handleTextMessage(data: string): void {
    try {
      const message = JSON.parse(data) as VonageControlMessage;
      this.dispatchTextMessage(message);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private dispatchTextMessage(message: VonageControlMessage): void {
    if ('event' in message) {
      if (message.event === 'websocket:connected') {
        this.handleConnected(message as VonageWebSocketConnectedMessage);
      } else if (message.event === 'websocket:disconnected') {
        this.handleDisconnected(message as VonageWebSocketDisconnectedMessage);
      }
    } else if ('speech' in message) {
      this.handleSpeech(message as VonageSpeechMessage);
    } else if ('dtmf' in message) {
      this.handleDTMF(message as VonageDTMFMessage);
    }
  }

  private handleBinaryMessage(data: Buffer): void {
    const sampleRate = 8000;

    const chunk: AudioChunk = {
      buffer: data,
      sampleRate,
      encoding: 'pcm',
      channels: 1,
      timestamp: Date.now(),
    };

    this.emit('audio:received', chunk);
  }

  private handleConnected(message: VonageWebSocketConnectedMessage): void {
    this.sessionId = message.conversation_uuid ?? message.uuid ?? null;

    const sessionMetadata: TransportSessionMetadata = {
      sessionId: this.sessionId ?? 'unknown',
      codec: 'pcm',
      sampleRate: 8000,
    };

    this.emit('session:start', sessionMetadata);
    this.emit('call:start', {
      sessionId: this.sessionId,
      conversationUuid: message.conversation_uuid ?? message.uuid,
    });
  }

  private handleDisconnected(message: VonageWebSocketDisconnectedMessage): void {
    const endedUuid = message.conversation_uuid ?? message.uuid ?? this.sessionId ?? 'unknown';
    this.sessionId = null;
    this.emit('session:end', { sessionId: endedUuid });
    this.emit('call:end', { sessionId: endedUuid });
  }

  private handleSpeech(message: VonageSpeechMessage): void {
    if (message.speech.results && message.speech.results.length > 0) {
      const topResult = message.speech.results[0];
      this.emit('speech:received', {
        text: topResult.text,
        confidence: topResult.confidence,
      });
    }
  }

  private handleDTMF(message: VonageDTMFMessage): void {
    this.emit('dtmf:received', {
      digit: message.dtmf.digit,
    });
  }

  static mulawToLinear16(mulawBuffer: Buffer): Buffer {
    const MULAW_BIAS = 0x84;
    const QUANT_MASK = 0x0f;
    const SEG_SHIFT = 0x04;
    const SEG_MASK = 0x70;

    const table = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
      const val = ~i;
      const t = ((val & QUANT_MASK) << 3) + MULAW_BIAS;
      const shifted = t << ((val & SEG_MASK) >> SEG_SHIFT);
      table[i] = (val & 0x80) !== 0 ? MULAW_BIAS - shifted : shifted - MULAW_BIAS;
    }

    const result = Buffer.alloc(mulawBuffer.length * 2);

    for (let i = 0; i < mulawBuffer.length; i++) {
      const sample = table[mulawBuffer[i] & 0xff];
      const offset = i * 2;
      result.writeInt16LE(sample, offset);
    }

    return result;
  }

  static linear16ToMulaw(pcmBuffer: Buffer): Buffer {
    const result = Buffer.alloc(pcmBuffer.length / 2);

    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      const sign = sample < 0 ? 0x80 : 0;
      const abs = Math.min(Math.abs(sample), 0x7fff);

      let exponent = 0;
      let temp = abs;
      for (let e = 7; e >= 0; e--) {
        if (temp >= 256) {
          exponent = e;
          break;
        }
        temp <<= 1;
      }

      const mantissa = 0x7f - (((abs >> (exponent + 3)) & 0x0f) | 0x10);
      const mulawByte = sign | (exponent << 4) | mantissa;

      result[i >> 1] = ~mulawByte & 0xff;
    }

    return result;
  }

  static encodeForVonage(buffer: Buffer, encoding: 'mulaw' | 'pcm' = 'mulaw'): Buffer {
    if (encoding === 'pcm') {
      return buffer;
    }
    return VonageTransport.mulawToLinear16(buffer);
  }

  static decodeFromVonage(buffer: Buffer, encoding: 'mulaw' | 'pcm' = 'pcm'): Buffer {
    if (encoding === 'mulaw') {
      return VonageTransport.linear16ToMulaw(buffer);
    }
    return buffer;
  }
}
