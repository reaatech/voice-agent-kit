import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebRTCTransportConfig } from '../src/webrtc-transport.js';
import { WebRTCTransport } from '../src/webrtc-transport.js';

function createMockWs() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};

  return {
    readyState: 1,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
    }),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    pong: vi.fn(),
    _simulateMessage: (data: Buffer) => {
      listeners.message?.(data);
    },
    _simulateClose: () => {
      listeners.close?.();
    },
    _simulateError: (err: Error) => {
      listeners.error?.(err);
    },
  };
}

describe('WebRTCTransport', () => {
  let transport: WebRTCTransport;

  beforeEach(() => {
    transport = new WebRTCTransport();
  });

  describe('Transport interface compliance', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('webrtc');
    });

    it('should start disconnected with null session', () => {
      expect(transport.isConnected).toBe(false);
      expect(transport.getSessionId()).toBeNull();
    });

    it('should implement Transport interface methods', () => {
      expect(typeof transport.acceptConnection).toBe('function');
      expect(typeof transport.sendAudio).toBe('function');
      expect(typeof transport.clearAudio).toBe('function');
      expect(typeof transport.close).toBe('function');
      expect(typeof transport.getSessionId).toBe('function');
    });
  });

  describe('Configuration', () => {
    it('should use default config values', () => {
      expect(transport.name).toBe('webrtc');
      expect(transport.isConnected).toBe(false);
      expect(transport.getSessionId()).toBeNull();
      expect(transport.isBargeInEnabled()).toBe(true);
      expect(transport.isTTSActive()).toBe(false);
    });

    it('should accept custom config', () => {
      const custom = new WebRTCTransport({
        outputSampleRate: 8000,
        outputChannels: 1,
        bargeInEnabled: false,
        minSpeechDuration: 500,
        confidenceThreshold: 0.9,
        silenceThreshold: 0.1,
      } satisfies Partial<WebRTCTransportConfig>);

      expect(custom.isBargeInEnabled()).toBe(false);
    });

    it('should check Opus availability', () => {
      const available = transport.isOpusAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Connection Lifecycle', () => {
    it('should accept WebSocket and emit connected event', async () => {
      const mockWs = createMockWs();

      const connected: boolean[] = [];
      transport.on('connected', () => connected.push(true));

      await transport.acceptConnection(mockWs as any);

      expect(connected.length).toBe(1);
      expect(transport.isConnected).toBe(true);
    });

    it('should emit disconnected event on WebSocket close', async () => {
      const mockWs = createMockWs();

      const disconnected: boolean[] = [];
      transport.on('disconnected', () => disconnected.push(true));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateClose();

      expect(disconnected.length).toBe(1);
      expect(transport.isConnected).toBe(false);
    });

    it('should emit session:end on close when session was active', async () => {
      const mockWs = createMockWs();

      const sessionEnds: { sessionId: string }[] = [];
      transport.on('session:end', (data: { sessionId: string }) => sessionEnds.push(data));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );

      const sid = transport.getSessionId();
      expect(sid).not.toBeNull();

      mockWs._simulateClose();
      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0].sessionId).toBe(sid);
    });

    it('should emit error event on WebSocket error', async () => {
      const mockWs = createMockWs();

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      const connPromise = transport.acceptConnection(mockWs as any);
      mockWs._simulateError(new Error('Connection refused'));
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

  describe('Message Protocol', () => {
    it('should handle start message and emit session:start', async () => {
      const mockWs = createMockWs();

      const sessionStarts: unknown[] = [];
      transport.on('session:start', (data: unknown) => sessionStarts.push(data));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );

      expect(sessionStarts.length).toBe(1);
      expect(sessionStarts[0]).toEqual(
        expect.objectContaining({
          codec: 'opus',
          sampleRate: 48000,
        }),
      );
      expect(transport.getSessionId()).not.toBeNull();
    });

    it('should handle start message with 16000Hz mono', async () => {
      const mockWs = createMockWs();

      const sessionStarts: unknown[] = [];
      transport.on('session:start', (data: unknown) => sessionStarts.push(data));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 16000, channels: 1 })),
      );

      expect(sessionStarts.length).toBe(1);
      const meta = sessionStarts[0] as Record<string, unknown>;
      expect(meta.sampleRate).toBe(16000);
      const cp = meta.customParameters as Record<string, string>;
      expect(cp.channels).toBe('1');
    });

    it('should emit error when Opus decode fails on audio message', async () => {
      const mockWs = createMockWs();

      const errors: unknown[] = [];
      transport.on('error', (err: unknown) => errors.push(err));

      await transport.acceptConnection(mockWs as any);
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'audio', data: 'dGVzdA==' })),
      );

      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toContain('Opus decode failed');
    });

    it('should handle audio message with empty data', async () => {
      const mockWs = createMockWs();

      const audioEvents: unknown[] = [];
      transport.on('audio:received', (data: unknown) => audioEvents.push(data));

      await transport.acceptConnection(mockWs as any);
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'audio', data: '' })),
      );

      expect(audioEvents.length).toBe(0);
    });

    it('should handle stop message and emit session:end', async () => {
      const mockWs = createMockWs();

      const sessionEnds: { sessionId: string }[] = [];
      transport.on('session:end', (data: { sessionId: string }) => sessionEnds.push(data));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );
      const sid = transport.getSessionId();

      mockWs._simulateMessage(Buffer.from(JSON.stringify({ type: 'stop' })));

      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0].sessionId).toBe(sid);
      expect(transport.getSessionId()).toBeNull();
    });

    it('should handle stop message when no session active', async () => {
      const mockWs = createMockWs();

      const sessionEnds: { sessionId: string }[] = [];
      transport.on('session:end', (data: { sessionId: string }) => sessionEnds.push(data));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(Buffer.from(JSON.stringify({ type: 'stop' })));

      expect(sessionEnds.length).toBe(0);
    });

    it('should emit error on invalid JSON', async () => {
      const mockWs = createMockWs();

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      await transport.acceptConnection(mockWs as any);

      mockWs._simulateMessage(Buffer.from('{not valid'));

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('Invalid WebRTC message');
    });

    it('should ignore unknown message types', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'unknown' })),
      );
    });

    it('should handle ArrayBuffer data', async () => {
      const mockWs = createMockWs();

      const sessionStarts: unknown[] = [];
      transport.on('session:start', (data: unknown) => sessionStarts.push(data));

      await transport.acceptConnection(mockWs as any);

      const encoder = new TextEncoder();
      const arrBuf = encoder.encode(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })).buffer;
      mockWs._simulateMessage(Buffer.from(arrBuf));

      expect(sessionStarts.length).toBe(1);
    });

    it('should handle Buffer array data', async () => {
      const mockWs = {
        ...createMockWs(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'open') cb();
          if (event === 'message') {
            const msg = Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 }));
            cb([msg]);
          }
        }),
      };

      const sessionStarts: unknown[] = [];
      transport.on('session:start', (data: unknown) => sessionStarts.push(data));

      await transport.acceptConnection(mockWs as any);

      expect(sessionStarts.length).toBe(1);
    });
  });

  describe('Audio Sending', () => {
    it('should send audio as Opus base64 to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const chunk = {
        buffer: Buffer.alloc(320),
        sampleRate: 16000,
        encoding: 'linear16' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);
    });

    it('should send opus-encoded audio without re-encoding', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const chunk = {
        buffer: Buffer.from([0x00, 0x01, 0x02]),
        sampleRate: 48000,
        encoding: 'opus' as const,
        channels: 2,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('audio');
      expect(typeof sent.data).toBe('string');
    });

    it('should not send audio when not connected', async () => {
      const chunk = {
        buffer: Buffer.alloc(320),
        sampleRate: 16000,
        encoding: 'linear16' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);
    });

    it('should send clear message to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      await transport.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('clear');
    });

    it('should reset TTS state on clearAudio', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      transport.setTTSPlaying(true);

      await transport.clearAudio();

      expect(transport.isTTSActive()).toBe(false);
    });

    it('should not send clear when not connected', async () => {
      await transport.clearAudio();
    });

    it('should send transcript message to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      transport.sendTranscript('Hello world', true, 0.95);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('transcript');
      expect(sent.text).toBe('Hello world');
      expect(sent.isFinal).toBe(true);
      expect(sent.confidence).toBe(0.95);
    });

    it('should send transcript without confidence', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      transport.sendTranscript('Hello world', false);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('transcript');
      expect(sent.isFinal).toBe(false);
      expect(sent.confidence).toBeUndefined();
    });

    it('should not send transcript when not connected', () => {
      transport.sendTranscript('Hello', false);
    });

    it('should handle mulaw encoding in sendAudio', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const mulawBuf = Buffer.alloc(2);
      mulawBuf[0] = 0x80;
      mulawBuf[1] = 0x7f;

      const chunk = {
        buffer: mulawBuf,
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);
    });
  });

  describe('TTS State', () => {
    it('should track TTS playing state', () => {
      transport.setTTSPlaying(true);
      expect(transport.isTTSActive()).toBe(true);

      transport.setTTSPlaying(false);
      expect(transport.isTTSActive()).toBe(false);
    });

    it('should reset barge-in state when TTS stops', () => {
      transport.setTTSPlaying(true);
      transport.setTTSPlaying(false);

      transport.setTTSPlaying(true);
      transport.onInterimTranscript('world', 0.9);

      expect(transport.isTTSActive()).toBe(true);
    });
  });

  describe('Barge-in Detection (via transcripts)', () => {
    it('should not trigger barge-in when TTS is not playing', () => {
      const bargeInEvents: unknown[] = [];
      transport.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      transport.onInterimTranscript('hello', 0.9);
      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in when disabled', () => {
      const disabled = new WebRTCTransport({ bargeInEnabled: false });
      disabled.setTTSPlaying(true);

      const bargeInEvents: unknown[] = [];
      disabled.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      disabled.onInterimTranscript('hello', 0.9);
      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in with low confidence', () => {
      transport.setTTSPlaying(true);

      const bargeInEvents: unknown[] = [];
      transport.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      transport.onInterimTranscript('hello', 0.3);
      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in with empty transcript', () => {
      transport.setTTSPlaying(true);

      const bargeInEvents: unknown[] = [];
      transport.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      transport.onInterimTranscript('', 0.9);
      expect(bargeInEvents.length).toBe(0);
    });

    it('should detect speech start time', () => {
      transport.setTTSPlaying(true);
      transport.onInterimTranscript('hello', 0.9);
    });

    it('should reset barge-in state when TTS stops', () => {
      transport.setTTSPlaying(true);
      transport.onInterimTranscript('hello', 0.9);
      transport.setTTSPlaying(false);

      transport.setTTSPlaying(true);
      transport.onInterimTranscript('world', 0.9);
    });

    it('should trigger barge-in after min duration via transcript', () => {
      const custom = new WebRTCTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      custom.setTTSPlaying(true);

      const bargeInEvents: unknown[] = [];
      custom.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });

    it('should not trigger barge-in after already triggered', () => {
      const custom = new WebRTCTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      custom.setTTSPlaying(true);

      const bargeInEvents: unknown[] = [];
      custom.on('barge-in:detected', (data: unknown) => bargeInEvents.push(data));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);
      custom.onInterimTranscript('more speech', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });
  });

  describe('close', () => {
    it('should clean up WebSocket on close', async () => {
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

    it('should reset barge-in state on close', async () => {
      const mockWs = createMockWs();

      transport.setTTSPlaying(true);
      transport.onInterimTranscript('hello', 0.9);

      await transport.acceptConnection(mockWs as any);
      await transport.close();

      expect(transport.isTTSActive()).toBe(false);
    });
  });

  describe('Barge-in via audio RMS', () => {
    it('should emit error when audio decode fails for barge-in RMS', async () => {
      const mockWs = createMockWs();

      const custom = new WebRTCTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.01,
        outputSampleRate: 16000,
        outputChannels: 1,
      });

      const errors: unknown[] = [];
      custom.on('error', (err: unknown) => errors.push(err));

      await custom.acceptConnection(mockWs as any);
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );
      custom.setTTSPlaying(true);

      const loudBuffer = Buffer.alloc(320);
      for (let i = 0; i < 160; i++) {
        loudBuffer.writeInt16LE(20000, i * 2);
      }

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({
          type: 'audio',
          data: loudBuffer.toString('base64'),
        })),
      );

      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toContain('Opus decode failed');
    });

    it('should send clear to browser on barge-in via transcript', async () => {
      const mockWs = createMockWs();

      const custom = new WebRTCTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.01,
        outputSampleRate: 16000,
        outputChannels: 1,
      });

      await custom.acceptConnection(mockWs as any);
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );
      custom.setTTSPlaying(true);

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('clear');
    });
  });
});
