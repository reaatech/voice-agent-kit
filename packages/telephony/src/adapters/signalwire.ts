import type { AudioChunk, Transport, TransportSessionMetadata } from '@reaatech/voice-agent-core';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface SignalWireTransportConfig {
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
  domain?: string;
  projectId?: string;
}

interface SignalWireStartMessage {
  event: 'start';
  start: {
    callSid: string;
    callId?: string;
    track: string;
    customParameters: Record<string, string>;
    codec: {
      payload_type: number;
      name: string;
      clock_rate: number;
    };
    streamSid?: string;
    streamId?: string;
  };
}

interface SignalWireMediaMessage {
  event: 'media';
  streamSid?: string;
  streamId?: string;
  media: {
    payload: string;
    timestamp: string;
  };
  track: string;
}

interface SignalWireStopMessage {
  event: 'stop';
  streamSid?: string;
  streamId?: string;
  stop: {
    callSid: string;
    callId?: string;
  };
}

interface SignalWireMarkMessage {
  event: 'mark';
  streamSid?: string;
  streamId?: string;
  mark: {
    name: string;
  };
}

interface SignalWireDTMFMessage {
  event: 'dtmf';
  streamSid?: string;
  streamId?: string;
  dtmf: {
    digit: string;
  };
}

type SignalWireMessage =
  | SignalWireStartMessage
  | SignalWireMediaMessage
  | SignalWireStopMessage
  | SignalWireMarkMessage
  | SignalWireDTMFMessage;

interface SignalWireOutboundMessage {
  event: 'media' | 'clear' | 'mark' | 'start';
  streamSid?: string;
  streamId?: string;
  media?: {
    payload: string;
  };
  mark?: {
    name: string;
  };
}

export interface BargeInEvent {
  callSid: string | null;
  streamSid: string | null;
  timestamp: number;
}

export class SignalWireTransport extends EventEmitter implements Transport {
  readonly name = 'signalwire' as const;
  private ws: WebSocket | null = null;
  private streamSid: string | null = null;
  private streamId: string | null = null;
  private callSid: string | null = null;
  private callId: string | null = null;
  isConnected = false;
  private isTTSPlaying = false;
  private currentMarkId = 0;

  private readonly bargeInEnabled: boolean;
  private readonly minSpeechDuration: number;
  private readonly confidenceThreshold: number;
  private readonly silenceThreshold: number;

  private readonly domain: string;
  private readonly projectId: string | undefined;

  private speechStartTime: number | null = null;
  private isBargeInTriggered = false;

  constructor(config: Partial<SignalWireTransportConfig> = {}) {
    super();
    this.bargeInEnabled = config.bargeInEnabled ?? false;
    this.minSpeechDuration = config.minSpeechDuration ?? 300;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.silenceThreshold = config.silenceThreshold ?? 0.3;
    this.domain = config.domain ?? 'signalwire.com';
    this.projectId = config.projectId;
  }

  getDomain(): string {
    return this.domain;
  }

  getProjectId(): string | undefined {
    return this.projectId;
  }

  getWebSocketEndpoint(): string {
    if (this.projectId) {
      return `wss://${this.projectId}.${this.domain}/api/relay/rest/streams`;
    }
    return `wss://${this.domain}/api/relay/rest/streams`;
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
    if (!this.isConnected || (!this.streamSid && !this.streamId)) {
      return;
    }

    const payload = chunk.buffer.toString('base64');
    const message: SignalWireOutboundMessage = {
      event: 'media',
      streamSid: this.streamSid ?? undefined,
      streamId: this.streamId ?? undefined,
      media: { payload },
    };

    this.ws?.send(JSON.stringify(message));
  }

  async clearAudio(): Promise<void> {
    if (!this.isConnected || (!this.streamSid && !this.streamId)) {
      return;
    }

    const message: SignalWireOutboundMessage = {
      event: 'clear',
      streamSid: this.streamSid ?? undefined,
      streamId: this.streamId ?? undefined,
    };

    this.ws?.send(JSON.stringify(message));
    this.isTTSPlaying = false;
    this.resetBargeInState();
  }

  async sendMark(): Promise<string> {
    if (!this.isConnected || (!this.streamSid && !this.streamId)) {
      return '';
    }

    const markName = `mark-${++this.currentMarkId}`;
    const message: SignalWireOutboundMessage = {
      event: 'mark',
      streamSid: this.streamSid ?? undefined,
      streamId: this.streamId ?? undefined,
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

  getSessionId(): string | null {
    return this.callSid ?? this.callId;
  }

  getCallSid(): string | null {
    return this.callSid;
  }

  getCallId(): string | null {
    return this.callId;
  }

  getStreamSid(): string | null {
    return this.streamSid ?? this.streamId;
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
      callSid: this.callSid ?? this.callId,
      streamSid: this.streamSid ?? this.streamId,
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
    this.streamId = null;
    this.callSid = null;
    this.callId = null;
    this.isTTSPlaying = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const message: SignalWireMessage = JSON.parse(data.toString());

      switch (message.event) {
        case 'start':
          this.handleStart(message as SignalWireStartMessage);
          break;
        case 'media':
          this.handleMedia(message as SignalWireMediaMessage);
          break;
        case 'stop':
          this.handleStop(message as SignalWireStopMessage);
          break;
        case 'mark':
          this.handleMark(message as SignalWireMarkMessage);
          break;
        case 'dtmf':
          this.handleDTMF(message as SignalWireDTMFMessage);
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  private handleStart(message: SignalWireStartMessage): void {
    this.callSid = message.start.callSid ?? null;
    this.callId = message.start.callId ?? null;
    this.streamSid = message.start.streamSid ?? null;
    this.streamId = message.start.streamId ?? null;

    const effectiveCallId = this.callSid ?? this.callId ?? 'unknown';
    const codecName =
      typeof message.start.codec === 'string'
        ? message.start.codec
        : (message.start.codec?.name ?? 'mulaw');
    const rate =
      typeof message.start.codec === 'string' ? 8000 : (message.start.codec?.clock_rate ?? 8000);

    const sessionMetadata: TransportSessionMetadata = {
      sessionId: effectiveCallId,
      codec: codecName,
      sampleRate: rate,
      customParameters: message.start.customParameters,
    };

    this.emit('session:start', sessionMetadata);
    this.emit('call:start', {
      callSid: this.callSid,
      callId: this.callId,
      streamSid: this.streamSid ?? this.streamId,
      codec: message.start.codec,
      customParameters: message.start.customParameters,
    });
  }

  private handleMedia(message: SignalWireMediaMessage): void {
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

  private handleStop(message: SignalWireStopMessage): void {
    const endedCallSid = message.stop.callSid ?? message.stop.callId ?? 'unknown';
    this.callSid = null;
    this.callId = null;
    this.streamSid = null;
    this.streamId = null;
    this.emit('session:end', { sessionId: endedCallSid });
    this.emit('call:end', { callSid: endedCallSid });
  }

  private handleMark(message: SignalWireMarkMessage): void {
    this.emit('mark:played', {
      streamSid: message.streamSid ?? message.streamId,
    });
  }

  private handleDTMF(message: SignalWireDTMFMessage): void {
    this.emit('dtmf:received', {
      digit: message.dtmf.digit,
      streamSid: message.streamSid ?? message.streamId,
    });
  }

  static encodeForSignalWire(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  static decodeFromSignalWire(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }
}
