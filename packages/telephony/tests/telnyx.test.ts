import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelnyxTransport } from '../src/adapters/telnyx.js';

function createMockWs(handlers?: { onOpen?: () => void; onMessage?: (data: Buffer) => void }) {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const mock = {
    readyState: 1,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
      if (event === 'open' && handlers?.onOpen) {
        handlers.onOpen();
        cb();
      }
    }),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    pong: vi.fn(),
  };
  (mock as any)._simulateMessage = (data: Buffer) => {
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

describe('TelnyxTransport', () => {
  let transport: TelnyxTransport;

  beforeEach(() => {
    transport = new TelnyxTransport();
  });

  describe('Transport interface compliance', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('telnyx');
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
      const thresholds = transport.getBargeInThresholds();
      expect(thresholds).toEqual({
        minSpeechDuration: 300,
        confidenceThreshold: 0.7,
        silenceThreshold: 0.3,
      });
    });

    it('should accept custom config', () => {
      const custom = new TelnyxTransport({
        bargeInEnabled: true,
        minSpeechDuration: 500,
        confidenceThreshold: 0.9,
        silenceThreshold: 0.1,
      });

      expect(custom.isBargeInEnabled()).toBe(true);
      const t = custom.getBargeInThresholds();
      expect(t.minSpeechDuration).toBe(500);
      expect(t.confidenceThreshold).toBe(0.9);
      expect(t.silenceThreshold).toBe(0.1);
    });

    it('should default bargeInEnabled to false', () => {
      expect(transport.isBargeInEnabled()).toBe(false);
    });

    it('should have null initial identifiers', () => {
      expect(transport.getSessionId()).toBeNull();
      expect(transport.getCallControlId()).toBeNull();
      expect(transport.getStreamId()).toBeNull();
    });
  });

  describe('Connection lifecycle', () => {
    it('should accept WebSocket connection and emit connected', async () => {
      const mockWs = createMockWs();

      const connectedEvents: boolean[] = [];
      transport.on('connected', () => connectedEvents.push(true));

      await transport.acceptConnection(mockWs as any);

      expect(connectedEvents.length).toBe(1);
      expect(transport.isConnected).toBe(true);
    });

    it('should emit disconnected on WebSocket close', async () => {
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

    it('should handle ping', () => {
      const mockWs = createMockWs();
      transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage;
      expect(typeof mockWs.pong).toBe('function');
    });
  });

  describe('Message handling', () => {
    it('should emit session:start and call:start on start message', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      const callStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));
      transport.on('call:start', (d: any) => callStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: {
              call_control_id: 'CC123',
              stream_id: 'STREAM123',
              codec: 'PCMU',
              custom_parameters: { foo: 'bar' },
            },
          }),
        ),
      );

      expect(sessionStarts.length).toBe(1);
      expect(callStarts.length).toBe(1);
      expect(sessionStarts[0]).toMatchObject({
        sessionId: 'CC123',
        codec: 'PCMU',
        sampleRate: 8000,
        customParameters: { foo: 'bar' },
      });
      expect(callStarts[0]).toMatchObject({
        callControlId: 'CC123',
        streamId: 'STREAM123',
      });
      expect(transport.getCallControlId()).toBe('CC123');
      expect(transport.getStreamId()).toBe('STREAM123');
    });

    it('should use default codec when start has no codec', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: {
              call_control_id: 'CC123',
              stream_id: 'STREAM123',
            },
          }),
        ),
      );

      expect(sessionStarts[0].codec).toBe('PCMU');
    });

    it('should emit audio:received on media message', async () => {
      const mockWs = createMockWs();
      const audioEvents: any[] = [];
      transport.on('audio:received', (d: any) => audioEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'media',
            stream_id: 'STREAM123',
            media: { payload: Buffer.from([0x00, 0x01]).toString('base64') },
          }),
        ),
      );

      expect(audioEvents.length).toBe(1);
      expect(audioEvents[0]).toMatchObject({
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
      });
    });

    it('should emit session:end and call:end on stop message', async () => {
      const mockWs = createMockWs();
      const sessionEnds: any[] = [];
      const callEnds: any[] = [];
      transport.on('session:end', (d: any) => sessionEnds.push(d));
      transport.on('call:end', (d: any) => callEnds.push(d));

      await transport.acceptConnection(mockWs as any);
      // Set up state first
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: { call_control_id: 'CC123', stream_id: 'STREAM123', codec: 'PCMU' },
          }),
        ),
      );
      // Then stop
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'stop',
            stop: { call_control_id: 'CC123' },
          }),
        ),
      );

      expect(sessionEnds.length).toBe(1);
      expect(callEnds.length).toBe(1);
      expect(sessionEnds[0]).toMatchObject({ sessionId: 'CC123' });
      expect(transport.getCallControlId()).toBeNull();
      expect(transport.getStreamId()).toBeNull();
    });

    it('should emit dtmf:received on dtmf message', async () => {
      const mockWs = createMockWs();
      const dtmfEvents: any[] = [];
      transport.on('dtmf:received', (d: any) => dtmfEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'dtmf',
            stream_id: 'STREAM123',
            dtmf: { digit: '3', duration: 200 },
          }),
        ),
      );

      expect(dtmfEvents.length).toBe(1);
      expect(dtmfEvents[0]).toMatchObject({ digit: '3', streamId: 'STREAM123' });
    });

    it('should emit error on malformed JSON', async () => {
      const mockWs = createMockWs();
      const errors: any[] = [];
      transport.on('error', (err: any) => errors.push(err));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(Buffer.from('not valid json'));

      expect(errors.length).toBe(1);
    });
  });

  describe('Audio sending', () => {
    it('should send audio as JSON command', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: { call_control_id: 'CC123', stream_id: 'STREAM123', codec: 'PCMU' },
          }),
        ),
      );

      const chunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      transport.sendAudio(chunk);

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.command).toBe('audio');
      expect(sent.stream_id).toBe('STREAM123');
      expect(typeof sent.payload).toBe('string');
    });

    it('should not send audio when not connected', () => {
      const mockWs = createMockWs();
      const chunk = {
        buffer: Buffer.from([0x00]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };
      transport.sendAudio(chunk);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('should not send audio when no stream ID', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);

      const chunk = {
        buffer: Buffer.from([0x00]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };
      transport.sendAudio(chunk);
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('clearAudio', () => {
    it('should send clear command', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: { call_control_id: 'CC123', stream_id: 'STREAM123', codec: 'PCMU' },
          }),
        ),
      );

      transport.setTTSPlaying(true);
      await transport.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.command).toBe('clear');
      expect(sent.stream_id).toBe('STREAM123');
      expect(transport.isTTSActive()).toBe(false);
    });

    it('should not clear when not connected', async () => {
      await transport.clearAudio();
    });
  });

  describe('Barge-in', () => {
    it('should not trigger barge-in when TTS is not playing', () => {
      const bargeInEvents: any[] = [];
      transport.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      transport.onInterimTranscript('hello', 0.9);

      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in when disabled', () => {
      transport.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      transport.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      transport.onInterimTranscript('hello', 0.9);

      expect(bargeInEvents.length).toBe(0);
    });

    it('should trigger barge-in after min speech duration', () => {
      const custom = new TelnyxTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      custom.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      custom.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
      expect(bargeInEvents[0]).toMatchObject({
        callControlId: null,
        streamId: null,
      });
      expect(typeof bargeInEvents[0].timestamp).toBe('number');
    });

    it('should reset speech start on empty transcript', () => {
      const custom = new TelnyxTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });
      custom.setTTSPlaying(true);

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('', 0.9);

      const bargeInEvents: any[] = [];
      custom.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      custom.onInterimTranscript('world', 0.9);
      custom.onInterimTranscript('world again', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });

    it('should emit barge-in with callControlId and streamId when available', async () => {
      const mockWs = createMockWs();

      const custom = new TelnyxTransport({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      await custom.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(
          JSON.stringify({
            event: 'start',
            start: { call_control_id: 'CC123', stream_id: 'STREAM123', codec: 'PCMU' },
          }),
        ),
      );

      custom.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      custom.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
      expect(bargeInEvents[0].callControlId).toBe('CC123');
      expect(bargeInEvents[0].streamId).toBe('STREAM123');
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

  describe('Static utilities', () => {
    it('should encode buffer to base64', () => {
      const buf = Buffer.from([0x00, 0x01, 0x02]);
      const encoded = TelnyxTransport.encodeForTelnyx(buf);
      expect(encoded).toBe('AAEC');
    });

    it('should decode base64 to buffer', () => {
      const decoded = TelnyxTransport.decodeFromTelnyx('AAEC');
      expect(decoded).toEqual(Buffer.from([0x00, 0x01, 0x02]));
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

  describe('resetBargeInState', () => {
    it('should reset barge-in state', () => {
      transport.onInterimTranscript('hello', 0.9);
      transport.resetBargeInState();
      expect(transport.isTTSActive()).toBe(false);
    });
  });
});
