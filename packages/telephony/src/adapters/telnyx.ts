import type { AudioChunk, Transport, TransportSessionMetadata } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface TelnyxTransportConfig {
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
}

interface TelnyxStartMessage {
  event: 'start';
  start: {
    call_control_id: string;
    stream_id: string;
    codec: string;
    custom_parameters?: Record<string, string>;
  };
}

interface TelnyxMediaMessage {
  event: 'media';
  sequence_number?: number;
  stream_id: string;
  media: {
    payload: string;
  };
}

interface TelnyxStopMessage {
  event: 'stop';
  stop: {
    call_control_id: string;
  };
}

interface TelnyxDTMFMessage {
  event: 'dtmf';
  stream_id: string;
  dtmf: {
    digit: string;
    duration?: number;
  };
}

type TelnyxMessage =
  | TelnyxStartMessage
  | TelnyxMediaMessage
  | TelnyxStopMessage
  | TelnyxDTMFMessage;

interface TelnyxOutboundCommand {
  command: 'audio' | 'clear';
  stream_id: string;
  payload?: string;
}

export interface BargeInEvent {
  callControlId: string | null;
  streamId: string | null;
  timestamp: number;
}

export class TelnyxTransport extends EventEmitter implements Transport {
  readonly name = 'telnyx' as const;
  private ws: WebSocket | null = null;
  private streamId: string | null = null;
  private callControlId: string | null = null;
  isConnected = false;
  private isTTSPlaying = false;

  private readonly bargeInEnabled: boolean;
  private readonly minSpeechDuration: number;
  private readonly confidenceThreshold: number;
  private readonly silenceThreshold: number;

  private speechStartTime: number | null = null;
  private isBargeInTriggered = false;

  constructor(config: Partial<TelnyxTransportConfig> = {}) {
    super();
    this.bargeInEnabled = config.bargeInEnabled ?? false;
    this.minSpeechDuration = config.minSpeechDuration ?? 300;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.silenceThreshold = config.silenceThreshold ?? 0.3;
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
    if (!this.isConnected || !this.streamId) {
      return;
    }

    const payload = chunk.buffer.toString('base64');
    const message: TelnyxOutboundCommand = {
      command: 'audio',
      stream_id: this.streamId,
      payload,
    };

    this.ws?.send(JSON.stringify(message));
  }

  async clearAudio(): Promise<void> {
    if (!this.isConnected || !this.streamId) {
      return;
    }

    const message: TelnyxOutboundCommand = {
      command: 'clear',
      stream_id: this.streamId,
    };

    this.ws?.send(JSON.stringify(message));
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
    return this.callControlId;
  }

  getCallControlId(): string | null {
    return this.callControlId;
  }

  getStreamId(): string | null {
    return this.streamId;
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
      callControlId: this.callControlId,
      streamId: this.streamId,
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
    this.streamId = null;
    this.callControlId = null;
    this.isTTSPlaying = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: TelnyxMessage = JSON.parse(data.toString());

      switch (message.event) {
        case 'start':
          this.handleStart(message as TelnyxStartMessage);
          break;
        case 'media':
          this.handleMedia(message as TelnyxMediaMessage);
          break;
        case 'stop':
          this.handleStop(message as TelnyxStopMessage);
          break;
        case 'dtmf':
          this.handleDTMF(message as TelnyxDTMFMessage);
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  private handleStart(message: TelnyxStartMessage): void {
    this.callControlId = message.start.call_control_id;
    this.streamId = message.start.stream_id;

    const codecName = message.start.codec ?? 'PCMU';

    const sessionMetadata: TransportSessionMetadata = {
      sessionId: this.callControlId,
      codec: codecName,
      sampleRate: 8000,
      customParameters: message.start.custom_parameters,
    };

    this.emit('session:start', sessionMetadata);
    this.emit('call:start', {
      callControlId: this.callControlId,
      streamId: this.streamId,
      codec: message.start.codec,
      customParameters: message.start.custom_parameters,
    });
  }

  private handleMedia(message: TelnyxMediaMessage): void {
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

  private handleStop(message: TelnyxStopMessage): void {
    const endedCallControlId = message.stop.call_control_id;
    this.callControlId = null;
    this.streamId = null;
    this.emit('session:end', { sessionId: endedCallControlId });
    this.emit('call:end', { callControlId: endedCallControlId });
  }

  private handleDTMF(message: TelnyxDTMFMessage): void {
    this.emit('dtmf:received', {
      digit: message.dtmf.digit,
      streamId: message.stream_id,
    });
  }

  static encodeForTelnyx(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  static decodeFromTelnyx(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }
}
