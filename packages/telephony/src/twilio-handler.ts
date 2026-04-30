import { EventEmitter } from 'events';

import type { AudioChunk } from '@reaatech/voice-agent-core';
import WebSocket from 'ws';

import type {
  TwilioDTMFMessage,
  TwilioMarkMessage,
  TwilioMediaMessage,
  TwilioMessage,
  TwilioOutboundMessage,
  TwilioStartMessage,
  TwilioStopMessage,
} from './types.js';

export interface TwilioHandlerConfig {
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
}

export interface BargeInEvent {
  callSid: string | null;
  streamSid: string | null;
  timestamp: number;
}

export class TwilioMediaStreamHandler extends EventEmitter {
  private ws: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private isConnected = false;
  private isTTSPlaying = false;
  private currentMarkId = 0;

  private readonly bargeInEnabled: boolean;
  private readonly minSpeechDuration: number;
  private readonly confidenceThreshold: number;
  private readonly silenceThreshold: number;

  private speechStartTime: number | null = null;
  private isBargeInTriggered = false;

  constructor(config: Partial<TwilioHandlerConfig> = {}) {
    super();
    this.bargeInEnabled = config.bargeInEnabled ?? false;
    this.minSpeechDuration = config.minSpeechDuration ?? 300;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.silenceThreshold = config.silenceThreshold ?? 0.3;
  }

  acceptConnection(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = ws;

      // Handle already-open WebSocket
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
    if (!this.isConnected || !this.streamSid) {
      return;
    }

    const payload = chunk.buffer.toString('base64');
    const message: TwilioOutboundMessage = {
      event: 'media',
      streamSid: this.streamSid,
      media: { payload },
    };

    this.ws?.send(JSON.stringify(message));
  }

  async clearAudio(): Promise<void> {
    if (!this.isConnected || !this.streamSid) {
      return;
    }

    const message: TwilioOutboundMessage = {
      event: 'clear',
      streamSid: this.streamSid,
    };

    this.ws?.send(JSON.stringify(message));
    this.isTTSPlaying = false;
    this.resetBargeInState();
  }

  async sendMark(): Promise<string> {
    if (!this.isConnected || !this.streamSid) {
      return '';
    }

    const markName = `mark-${++this.currentMarkId}`;
    const message: TwilioOutboundMessage = {
      event: 'mark',
      streamSid: this.streamSid,
      mark: { name: markName },
    };

    this.ws?.send(JSON.stringify(message));
    return markName;
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

  getCallSid(): string | null {
    return this.callSid;
  }

  getStreamSid(): string | null {
    return this.streamSid;
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
      callSid: this.callSid,
      streamSid: this.streamSid,
      timestamp: Date.now(),
    };

    this.emit('barge-in:detected', event);

    this.isTTSPlaying = false;
  }

  resetBargeInState(): void {
    this.speechStartTime = null;
    this.isBargeInTriggered = false;
  }

  async close(): Promise<void> {
    this.isConnected = false;
    this.streamSid = null;
    this.callSid = null;
    this.isTTSPlaying = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: TwilioMessage = JSON.parse(data.toString());

      switch (message.event) {
        case 'start':
          this.handleStart(message as TwilioStartMessage);
          break;
        case 'media':
          this.handleMedia(message as TwilioMediaMessage);
          break;
        case 'stop':
          this.handleStop(message as TwilioStopMessage);
          break;
        case 'mark':
          this.handleMark(message as TwilioMarkMessage);
          break;
        case 'dtmf':
          this.handleDTMF(message as TwilioDTMFMessage);
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  private handleStart(message: TwilioStartMessage): void {
    this.callSid = message.start.callSid;
    this.streamSid = message.start.streamSid || message.start.callSid;

    this.emit('call:start', {
      callSid: this.callSid,
      streamSid: this.streamSid,
      codec: message.start.codec,
      customParameters: message.start.customParameters,
    });
  }

  private handleMedia(message: TwilioMediaMessage): void {
    const audioBuffer = Buffer.from(message.media.payload, 'base64');

    const chunk: AudioChunk = {
      buffer: audioBuffer,
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    this.emit('audio:received', chunk);
  }

  private handleStop(message: TwilioStopMessage): void {
    this.callSid = null;
    this.streamSid = null;
    this.emit('call:end', { callSid: message.stop.callSid });
  }

  private handleMark(message: TwilioMarkMessage): void {
    this.emit('mark:played', { streamSid: message.streamSid });
  }

  private handleDTMF(message: TwilioDTMFMessage): void {
    this.emit('dtmf:received', {
      digit: message.dtmf.digit,
      streamSid: message.streamSid,
    });
  }

  /** Encode audio buffer to base64 for Twilio */
  static encodeForTwilio(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  /** Decode base64 audio from Twilio to buffer */
  static decodeFromTwilio(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }
}
