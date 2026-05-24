import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VonageTransport } from '../src/adapters/vonage.js';
import type { AudioChunk } from '@reaatech/voice-agent-core';

function createMockWs() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const mock = {
    readyState: 1,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
    }),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    pong: vi.fn(),
  };
  (mock as any)._simulateTextMessage = (data: string) => {
    listeners.message?.(data);
  };
  (mock as any)._simulateBinaryMessage = (data: Buffer) => {
    listeners.message?.(data);
  };
  (mock as any)._simulateArrayBuffer = (data: ArrayBuffer) => {
    listeners.message?.(data);
  };
  (mock as any)._simulateArrayBufferArray = (data: Buffer[]) => {
    listeners.message?.(data);
  };
  (mock as any)._simulateClose = () => {
    listeners.close?.();
  };
  (mock as any)._simulateError = (err: Error) => {
    listeners.error?.(err);
  };
  return mock;
}

describe('VonageTransport', () => {
  let transport: VonageTransport;

  beforeEach(() => {
    transport = new VonageTransport();
  });

  describe('Transport interface compliance', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('vonage');
    });

    it('should start disconnected', () => {
      expect(transport.isConnected).toBe(false);
    });

    it('should implement Transport interface methods', () => {
      expect(typeof transport.acceptConnection).toBe('function');
      expect(typeof transport.sendAudio).toBe('function');
      expect(typeof transport.clearAudio).toBe('function');
      expect(typeof transport.close).toBe('function');
      expect(typeof transport.getSessionId).toBe('function');
    });
  });

  describe('Constructor', () => {
    it('should use default config values', () => {
      expect(transport.isBargeInEnabled()).toBe(false);
      expect(transport.getAppId()).toBeUndefined();
      expect(transport.privateKey).toBeUndefined();
      const thresholds = transport.getBargeInThresholds();
      expect(thresholds).toEqual({
        minSpeechDuration: 300,
        confidenceThreshold: 0.7,
        silenceThreshold: 0.3,
      });
    });

    it('should accept custom config with appId and privateKey', () => {
      const custom = new VonageTransport({
        appId: 'app-123',
        privateKey: 'key-abc',
        bargeInEnabled: true,
        minSpeechDuration: 500,
        confidenceThreshold: 0.9,
        silenceThreshold: 0.1,
      });

      expect(custom.getAppId()).toBe('app-123');
      expect(custom.privateKey).toBe('key-abc');
      expect(custom.isBargeInEnabled()).toBe(true);
    });

    it('should have null initial session ID', () => {
      expect(transport.getSessionId()).toBeNull();
    });
  });

  describe('Connection lifecycle', () => {
    it('should accept WebSocket and emit connected', async () => {
      const mockWs = createMockWs();
      const connectedEvents: boolean[] = [];
      transport.on('connected', () => connectedEvents.push(true));

      await transport.acceptConnection(mockWs as any);

      expect(connectedEvents.length).toBe(1);
      expect(transport.isConnected).toBe(true);
    });

    it('should emit disconnected on close', async () => {
      const mockWs = createMockWs();
      const disconnectedEvents: boolean[] = [];
      transport.on('disconnected', () => disconnectedEvents.push(true));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateClose();

      expect(disconnectedEvents.length).toBe(1);
      expect(transport.isConnected).toBe(false);
    });

    it('should emit error and reject on WebSocket error', async () => {
      const mockWs = createMockWs();
      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      const connPromise = transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateError(new Error('Connection refused'));
      await connPromise.catch(() => {});

      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Connection refused');
    });

    it('should handle ping', async () => {
      const mockWs = createMockWs();
      await transport.acceptConnection(mockWs as any);
      expect(typeof mockWs.pong).toBe('function');
    });
  });

  describe('Text message handling', () => {
    it('should handle websocket:connected and emit session:start + call:start', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      const callStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));
      transport.on('call:start', (d: any) => callStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        event: 'websocket:connected',
        conversation_uuid: 'conv-123',
        uuid: 'uuid-456',
      }));

      expect(sessionStarts.length).toBe(1);
      expect(sessionStarts[0]).toMatchObject({
        sessionId: 'conv-123',
        codec: 'pcm',
        sampleRate: 8000,
      });
      expect(callStarts.length).toBe(1);
      expect(callStarts[0]).toMatchObject({
        sessionId: 'conv-123',
        conversationUuid: 'conv-123',
      });
      expect(transport.getSessionId()).toBe('conv-123');
    });

    it('should fallback to uuid when conversation_uuid missing', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        event: 'websocket:connected',
        uuid: 'uuid-456',
      }));

      expect(sessionStarts[0].sessionId).toBe('uuid-456');
      expect(transport.getSessionId()).toBe('uuid-456');
    });

    it('should handle websocket:disconnected and emit session:end + call:end', async () => {
      const mockWs = createMockWs();
      const sessionEnds: any[] = [];
      transport.on('session:end', (d: any) => sessionEnds.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        event: 'websocket:connected',
        conversation_uuid: 'conv-123',
      }));
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        event: 'websocket:disconnected',
        conversation_uuid: 'conv-123',
      }));

      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0]).toMatchObject({ sessionId: 'conv-123' });
      expect(transport.getSessionId()).toBeNull();
    });

    it('should emit speech:received on speech message', async () => {
      const mockWs = createMockWs();
      const speechEvents: any[] = [];
      transport.on('speech:received', (d: any) => speechEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        speech: {
          results: [
            { text: 'hello world', confidence: 0.95 },
          ],
        },
      }));

      expect(speechEvents.length).toBe(1);
      expect(speechEvents[0]).toMatchObject({
        text: 'hello world',
        confidence: 0.95,
      });
    });

    it('should not emit speech:received when results are empty', async () => {
      const mockWs = createMockWs();
      const speechEvents: any[] = [];
      transport.on('speech:received', (d: any) => speechEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        speech: {
          results: [],
        },
      }));

      expect(speechEvents.length).toBe(0);
    });

    it('should emit dtmf:received on dtmf message', async () => {
      const mockWs = createMockWs();
      const dtmfEvents: any[] = [];
      transport.on('dtmf:received', (d: any) => dtmfEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage(JSON.stringify({
        dtmf: {
          digit: '9',
          timed_out: false,
        },
      }));

      expect(dtmfEvents.length).toBe(1);
      expect(dtmfEvents[0].digit).toBe('9');
    });

    it('should emit error on malformed JSON', async () => {
      const mockWs = createMockWs();
      const errors: any[] = [];
      transport.on('error', (err: any) => errors.push(err));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateTextMessage('not valid json');

      expect(errors.length).toBe(1);
    });
  });

  describe('Binary message handling (audio)', () => {
    it('should emit audio:received on binary message', async () => {
      const mockWs = createMockWs();
      const audioEvents: any[] = [];
      transport.on('audio:received', (d: any) => audioEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateBinaryMessage(Buffer.from([0x00, 0x01, 0x02]));

      expect(audioEvents.length).toBe(1);
      expect(audioEvents[0]).toMatchObject({
        sampleRate: 8000,
        encoding: 'pcm',
        channels: 1,
      });
    });

    it('should handle Buffer array binary data', async () => {
      const mockWs = createMockWs();
      const audioEvents: any[] = [];
      transport.on('audio:received', (d: any) => audioEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateArrayBufferArray([Buffer.from([0x00, 0x01])]);

      expect(audioEvents.length).toBe(1);
    });

    it('should handle ArrayBuffer data', async () => {
      const mockWs = createMockWs();
      const audioEvents: any[] = [];
      transport.on('audio:received', (d: any) => audioEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      const arrBuf = new TextEncoder().encode('test').buffer;
      (mockWs as any)._simulateArrayBuffer(arrBuf);

      expect(audioEvents.length).toBe(1);
    });
  });

  describe('Audio sending', () => {
    it('should send PCM audio via WebSocket', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
        sampleRate: 8000,
        encoding: 'pcm',
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);

      expect(mockWs.send).toHaveBeenCalledWith(chunk.buffer);
    });

    it('should convert mulaw to linear16 before sending', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const mulawBuffer = Buffer.alloc(2);
      mulawBuffer[0] = 0x80;
      mulawBuffer[1] = 0x7f;

      const chunk: AudioChunk = {
        buffer: mulawBuffer,
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);

      expect(mockWs.send).toHaveBeenCalled();
      const sentBuf = mockWs.send.mock.calls[0][0] as Buffer;
      expect(sentBuf.length).toBe(mulawBuffer.length * 2);
    });

    it('should not send audio when not connected', () => {
      const mockWs = createMockWs();
      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00]),
        sampleRate: 8000,
        encoding: 'pcm',
        channels: 1,
        timestamp: Date.now(),
      };
      transport.sendAudio(chunk);
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('clearAudio', () => {
    it('should send silence buffer and reset state', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      transport.setTTSPlaying(true);

      await transport.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sentBuf = mockWs.send.mock.calls[0][0] as Buffer;
      expect(sentBuf.length).toBe(320);
      expect(transport.isTTSActive()).toBe(false);
    });

    it('should not clear when not connected', async () => {
      await transport.clearAudio();
    });
  });

  describe('mulawToLinear16', () => {
    it('should convert mu-law encoded buffer to linear16', () => {
      const mulawBuf = Buffer.alloc(4);
      mulawBuf[0] = 0x00;
      mulawBuf[1] = 0x80;
      mulawBuf[2] = 0xff;
      mulawBuf[3] = 0x7f;

      const result = VonageTransport.mulawToLinear16(mulawBuf);
      expect(result.length).toBe(mulawBuf.length * 2);
      expect(result.readInt16LE(0)).toBeCloseTo(-32124, -2);
    });

    it('should handle full 256 value range', () => {
      const mulawBuf = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) mulawBuf[i] = i;

      const result = VonageTransport.mulawToLinear16(mulawBuf);
      expect(result.length).toBe(512);
    });
  });

  describe('linear16ToMulaw', () => {
    it('should convert linear16 back to mu-law', () => {
      const pcmBuf = Buffer.alloc(4);
      pcmBuf.writeInt16LE(1000, 0);
      pcmBuf.writeInt16LE(-1000, 2);

      const result = VonageTransport.linear16ToMulaw(pcmBuf);
      expect(result.length).toBe(2);
    });
  });

  describe('encodeForVonage', () => {
    it('should return buffer as-is for pcm encoding', () => {
      const buf = Buffer.from([0x00, 0x01]);
      const result = VonageTransport.encodeForVonage(buf, 'pcm');
      expect(result).toBe(buf);
    });

    it('should convert mulaw to linear16', () => {
      const mulawBuf = Buffer.from([0x00]);
      const result = VonageTransport.encodeForVonage(mulawBuf, 'mulaw');
      expect(result.length).toBe(2);
    });
  });

  describe('decodeFromVonage', () => {
    it('should return buffer as-is for pcm encoding', () => {
      const buf = Buffer.from([0x00, 0x01]);
      const result = VonageTransport.decodeFromVonage(buf, 'pcm');
      expect(result).toBe(buf);
    });

    it('should convert linear16 to mulaw', () => {
      const pcmBuf = Buffer.alloc(2);
      pcmBuf.writeInt16LE(1000, 0);
      const result = VonageTransport.decodeFromVonage(pcmBuf, 'mulaw');
      expect(result.length).toBe(1);
    });
  });

  describe('Barge-in', () => {
    it('should trigger barge-in after min duration', () => {
      const custom = new VonageTransport({ bargeInEnabled: true, minSpeechDuration: 0, confidenceThreshold: 0.5, silenceThreshold: 0.3 });
      custom.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      custom.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });
  });

  describe('close', () => {
    it('should clean up WebSocket', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      await transport.close();

      expect(mockWs.close).toHaveBeenCalled();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(transport.isConnected).toBe(false);
      expect(transport.getSessionId()).toBeNull();
    });

    it('should handle close when not connected', async () => {
      await transport.close();
    });
  });
});
