import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type {
  Transport,
  TransportConfig,
  TransportSessionMetadata,
  TransportType,
} from '../src/transport/index.js';
import type { AudioChunk } from '../src/types/index.js';

describe('Transport', () => {
  it('should be implementable with all required members', () => {
    const transport: Transport = new (class extends EventEmitter implements Transport {
      readonly name = 'mock-transport';
      readonly isConnected = false;

      async acceptConnection(_connection: unknown): Promise<void> {
        // noop
      }

      sendAudio(_chunk: AudioChunk): void {
        // noop
      }

      async clearAudio(): Promise<void> {
        // noop
      }

      getSessionId(): string | null {
        return null;
      }

      async close(): Promise<void> {
        // noop
      }
    })();

    expect(transport.name).toBe('mock-transport');
    expect(transport.isConnected).toBe(false);
    expect(transport).toBeInstanceOf(EventEmitter);
  });

  it('should allow setting isConnected', () => {
    const transport = new (class extends EventEmitter implements Transport {
      name = 'mock-transport';
      isConnected = false;

      async acceptConnection(_connection: unknown): Promise<void> {}
      sendAudio(_chunk: AudioChunk): void {}
      async clearAudio(): Promise<void> {}
      getSessionId(): string | null {
        return null;
      }
      async close(): Promise<void> {}
    })();

    expect(transport.isConnected).toBe(false);
    transport.isConnected = true;
    expect(transport.isConnected).toBe(true);
  });

  it('should return a session ID from getSessionId', () => {
    const transport = new (class extends EventEmitter implements Transport {
      name = 'mock-transport';
      isConnected = true;
      private sessionId = 'session-abc-123';

      async acceptConnection(_connection: unknown): Promise<void> {}
      sendAudio(_chunk: AudioChunk): void {}
      async clearAudio(): Promise<void> {}
      getSessionId(): string | null {
        return this.sessionId;
      }
      async close(): Promise<void> {
        this.isConnected = false;
      }
    })();

    expect(transport.getSessionId()).toBe('session-abc-123');
  });

  describe('event types', () => {
    it('should emit connected event', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = false;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return null;
        }
        async close(): Promise<void> {}

        emitConnected(): void {
          this.emit('connected');
        }
      })();

      const handler = vi.fn();
      transport.on('connected', handler);
      transport.emitConnected();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit disconnected event', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = true;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return null;
        }
        async close(): Promise<void> {}

        emitDisconnected(): void {
          this.emit('disconnected');
        }
      })();

      const handler = vi.fn();
      transport.on('disconnected', handler);
      transport.emitDisconnected();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit audio:received event with AudioChunk', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = true;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return null;
        }
        async close(): Promise<void> {}

        receiveAudio(chunk: AudioChunk): void {
          this.emit('audio:received', chunk);
        }
      })();

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: 1000,
      };

      const handler = vi.fn();
      transport.on('audio:received', handler);
      transport.receiveAudio(chunk);

      expect(handler).toHaveBeenCalledWith(chunk);
    });

    it('should emit session:start event with metadata', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = true;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return 'session-1';
        }
        async close(): Promise<void> {}

        startSession(metadata: TransportSessionMetadata): void {
          this.emit('session:start', metadata);
        }
      })();

      const metadata: TransportSessionMetadata = {
        sessionId: 'session-1',
        codec: 'mulaw',
        sampleRate: 8000,
      };

      const handler = vi.fn();
      transport.on('session:start', handler);
      transport.startSession(metadata);

      expect(handler).toHaveBeenCalledWith(metadata);
    });

    it('should emit session:end event', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = true;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return 'session-1';
        }
        async close(): Promise<void> {}

        endSession(): void {
          this.emit('session:end', { sessionId: 'session-1' });
        }
      })();

      const handler = vi.fn();
      transport.on('session:end', handler);
      transport.endSession();

      expect(handler).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });

    it('should emit error event with Error', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = true;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return null;
        }
        async close(): Promise<void> {}

        fail(error: Error): void {
          this.emit('error', error);
        }
      })();

      const error = new Error('Transport error');
      const handler = vi.fn();
      transport.on('error', handler);
      transport.fail(error);

      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should support chaining on() calls', () => {
      const transport = new (class extends EventEmitter implements Transport {
        readonly name = 'mock-transport';
        readonly isConnected = false;

        async acceptConnection(_connection: unknown): Promise<void> {}
        sendAudio(_chunk: AudioChunk): void {}
        async clearAudio(): Promise<void> {}
        getSessionId(): string | null {
          return null;
        }
        async close(): Promise<void> {}
      })();

      const result = transport.on('connected', () => {});
      expect(result).toBe(transport);
    });
  });

  describe('TransportConfig', () => {
    it('should allow creating a transport config', () => {
      const config: TransportConfig = {
        bargeInEnabled: true,
        minSpeechDuration: 300,
        confidenceThreshold: 0.7,
        silenceThreshold: 0.3,
      };

      expect(config.bargeInEnabled).toBe(true);
      expect(config.minSpeechDuration).toBe(300);
      expect(config.confidenceThreshold).toBe(0.7);
      expect(config.silenceThreshold).toBe(0.3);
    });
  });

  describe('TransportType', () => {
    it('should accept valid transport types', () => {
      const types: TransportType[] = ['twilio', 'webrtc', 'telnyx', 'signalwire', 'vonage', 'sip'];
      expect(types).toHaveLength(6);
    });
  });
});
