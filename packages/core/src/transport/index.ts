import type { EventEmitter } from 'events';

import type { AudioChunk } from '../types/index.js';

export interface Transport extends EventEmitter {
  readonly name: string;
  readonly isConnected: boolean;

  acceptConnection(connection: unknown): Promise<void>;

  sendAudio(chunk: AudioChunk): void;

  clearAudio(): Promise<void>;

  getSessionId(): string | null;

  close(): Promise<void>;

  // Event signatures
  on(event: 'connected', cb: () => void): this;
  on(event: 'disconnected', cb: () => void): this;
  on(event: 'audio:received', cb: (chunk: AudioChunk) => void): this;
  on(event: 'session:start', cb: (metadata: TransportSessionMetadata) => void): this;
  on(event: 'session:end', cb: (metadata: { sessionId: string }) => void): this;
  on(event: 'error', cb: (error: Error) => void): this;
}

export interface TransportSessionMetadata {
  sessionId: string;
  codec: string;
  sampleRate: number;
  customParameters?: Record<string, string>;
}

export interface TransportConfig {
  bargeInEnabled: boolean;
  minSpeechDuration: number;
  confidenceThreshold: number;
  silenceThreshold: number;
}

export type TransportType = 'twilio' | 'webrtc' | 'telnyx' | 'signalwire' | 'vonage' | 'sip';
