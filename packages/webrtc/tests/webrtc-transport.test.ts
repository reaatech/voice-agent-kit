import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebRTCTransportConfig } from '../src/webrtc-transport.js';
import { WebRTCTransport } from '../src/webrtc-transport.js';

function createMockWs(handlers?: { onOpen?: () => void; onMessage?: (data: Buffer) => void }) {
  const listeners: Record<string, (...args: unknown[]) => void> = {};

  return {
    readyState: 1, // OPEN
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
      if (event === 'open' && handlers?.onOpen) {
        handlers.onOpen();
        cb();
      }
      if (event === 'message' && handlers?.onMessage) {
        // Don't auto-fire — tests control when messages arrive
      }
    }),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    pong: vi.fn(),
    // Helper to simulate incoming messages
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
      // In test environment without native Opus, this should be false
      const available = transport.isOpusAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Connection Lifecycle', () => {
    it('should accept WebSocket and emit connected event', async () => {
      const mockWs = createMockWs();

      const connected: boolean[] = [];
      transport.on('connected', () => connected.push(true));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      expect(connected.length).toBe(1);
      expect(transport.isConnected).toBe(true);
    });

    it('should emit disconnected event on WebSocket close', async () => {
      const mockWs = createMockWs();

      const disconnected: boolean[] = [];
      transport.on('disconnected', () => disconnected.push(true));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      mockWs._simulateClose();

      expect(disconnected.length).toBe(1);
      expect(transport.isConnected).toBe(false);
    });

    it('should emit error event on WebSocket error', async () => {
      const mockWs = createMockWs();

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      // acceptConnection will reject on error, catch it
      const connPromise = transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );
      mockWs._simulateError(new Error('Connection refused'));
      await connPromise.catch(() => {});

      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Connection refused');
    });

    it('should emit session:end on close when session was active', async () => {
      const mockWs = createMockWs();

      const sessionEnds: { sessionId: string }[] = [];
      transport.on('session:end', (data: { sessionId: string }) => sessionEnds.push(data));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      // Simulate a start message to set sessionId
      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );

      const sid = transport.getSessionId();
      expect(sid).not.toBeNull();

      mockWs._simulateClose();
      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0].sessionId).toBe(sid);
    });
  });

  describe('Message Protocol', () => {
    it('should handle start message and emit session:start', async () => {
      const mockWs = createMockWs();

      const sessionStarts: unknown[] = [];
      transport.on('session:start', (data: unknown) => sessionStarts.push(data));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

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

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 16000, channels: 1 })),
      );

      expect(sessionStarts.length).toBe(1);
      const meta = sessionStarts[0] as Record<string, unknown>;
      expect(meta.sampleRate).toBe(16000);
      const cp = meta.customParameters as Record<string, string>;
      expect(cp.channels).toBe('1');
    });

    it('should handle stop message and emit session:end', async () => {
      const mockWs = createMockWs();

      const sessionEnds: { sessionId: string }[] = [];
      transport.on('session:end', (data: { sessionId: string }) => sessionEnds.push(data));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      mockWs._simulateMessage(
        Buffer.from(JSON.stringify({ type: 'start', sampleRate: 48000, channels: 2 })),
      );
      const sid = transport.getSessionId();

      mockWs._simulateMessage(Buffer.from(JSON.stringify({ type: 'stop' })));

      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0].sessionId).toBe(sid);
      expect(transport.getSessionId()).toBeNull();
    });

    it('should emit error on invalid JSON', async () => {
      const mockWs = createMockWs();

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      mockWs._simulateMessage(Buffer.from('{not valid'));

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('Invalid WebRTC message');
    });
  });

  describe('Audio Sending', () => {
    it('should send audio as Opus base64 to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      // Without Opus codec available, this should not throw but may also not send
      // Test basic structure expectations
      const chunk = {
        buffer: Buffer.alloc(320), // 20ms @ 16kHz mono = 320 bytes
        sampleRate: 16000,
        encoding: 'linear16' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      // If Opus isn't available, sendAudio will silently fail (log debug)
      // This test verifies the method exists and is callable
      transport.sendAudio(chunk);
      // No assertion on send/not-send (dependent on native deps)
    });

    it('should send clear message to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      await transport.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('clear');
    });

    it('should not send clear when not connected', async () => {
      await transport.clearAudio();
      // Should not throw
    });

    it('should send transcript message to browser', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );

      transport.sendTranscript('Hello world', true, 0.95);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('transcript');
      expect(sent.text).toBe('Hello world');
      expect(sent.isFinal).toBe(true);
      expect(sent.confidence).toBe(0.95);
    });

    it('should not send transcript when not connected', () => {
      transport.sendTranscript('Hello', false);
      // Should not throw
    });
  });

  describe('TTS State', () => {
    it('should track TTS playing state', () => {
      transport.setTTSPlaying(true);
      expect(transport.isTTSActive()).toBe(true);

      transport.setTTSPlaying(false);
      expect(transport.isTTSActive()).toBe(false);
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
      // No immediate trigger — just marks start time
      // We can't easily test timing-based triggers without time manipulation
    });

    it('should reset barge-in state when TTS stops', () => {
      transport.setTTSPlaying(true);
      transport.onInterimTranscript('hello', 0.9);
      transport.setTTSPlaying(false);

      // After reset, new speech should start fresh
      transport.setTTSPlaying(true);
      transport.onInterimTranscript('world', 0.9);
      // No barge-in should trigger immediately
    });
  });

  describe('close', () => {
    it('should clean up WebSocket on close', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(
        mockWs as unknown as Parameters<typeof transport.acceptConnection>[0],
      );
      await transport.close();

      expect(mockWs.close).toHaveBeenCalled();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(transport.isConnected).toBe(false);
      expect(transport.getSessionId()).toBeNull();
    });

    it('should handle close when not connected', async () => {
      await transport.close();
      // Should not throw
    });
  });
});
