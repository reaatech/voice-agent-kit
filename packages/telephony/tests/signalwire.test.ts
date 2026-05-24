import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalWireTransport } from '../src/adapters/signalwire.js';

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

describe('SignalWireTransport', () => {
  let transport: SignalWireTransport;

  beforeEach(() => {
    transport = new SignalWireTransport();
  });

  describe('Transport interface compliance', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('signalwire');
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
      expect(transport.getDomain()).toBe('signalwire.com');
      expect(transport.getProjectId()).toBeUndefined();
      const thresholds = transport.getBargeInThresholds();
      expect(thresholds).toEqual({
        minSpeechDuration: 300,
        confidenceThreshold: 0.7,
        silenceThreshold: 0.3,
      });
    });

    it('should accept custom config with domain and projectId', () => {
      const custom = new SignalWireTransport({
        domain: 'custom.signalwire.com',
        projectId: 'proj-123',
        bargeInEnabled: true,
        minSpeechDuration: 500,
        confidenceThreshold: 0.9,
        silenceThreshold: 0.1,
      });

      expect(custom.getDomain()).toBe('custom.signalwire.com');
      expect(custom.getProjectId()).toBe('proj-123');
      expect(custom.isBargeInEnabled()).toBe(true);
    });

    it('should generate correct WebSocket endpoint without projectId', () => {
      expect(transport.getWebSocketEndpoint()).toBe('wss://signalwire.com/api/relay/rest/streams');
    });

    it('should generate correct WebSocket endpoint with projectId', () => {
      const custom = new SignalWireTransport({ projectId: 'proj-123' });
      expect(custom.getWebSocketEndpoint()).toBe('wss://proj-123.signalwire.com/api/relay/rest/streams');
    });

    it('should have null initial identifiers', () => {
      expect(transport.getSessionId()).toBeNull();
      expect(transport.getCallSid()).toBeNull();
      expect(transport.getCallId()).toBeNull();
      expect(transport.getStreamSid()).toBeNull();
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
  });

  describe('Message handling', () => {
    it('should emit session:start and call:start on start message with streamSid', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      const callStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));
      transport.on('call:start', (d: any) => callStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: {
            callSid: 'CA123',
            streamSid: 'MS123',
            codec: { name: 'mulaw', payload_type: 0, clock_rate: 8000 },
            customParameters: { foo: 'bar' },
          },
        })),
      );

      expect(sessionStarts.length).toBe(1);
      expect(sessionStarts[0]).toMatchObject({
        sessionId: 'CA123',
        codec: 'mulaw',
        sampleRate: 8000,
        customParameters: { foo: 'bar' },
      });
      expect(callStarts.length).toBe(1);
      expect(transport.getCallSid()).toBe('CA123');
      expect(transport.getStreamSid()).toBe('MS123');
      expect(transport.getSessionId()).toBe('CA123');
    });

    it('should handle start message with streamId and callId instead of SIDs', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: {
            callId: 'call-456',
            streamId: 'stream-789',
            codec: 'opus',
            customParameters: {},
          },
        })),
      );

      expect(sessionStarts[0].sessionId).toBe('call-456');
      expect(transport.getCallId()).toBe('call-456');
      expect(transport.getStreamSid()).toBe('stream-789');
    });

    it('should use unknown when no callSid or callId', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: {
            codec: 'mulaw',
            customParameters: {},
          },
        })),
      );

      expect(sessionStarts[0].sessionId).toBe('unknown');
    });

    it('should handle codec as string', async () => {
      const mockWs = createMockWs();
      const sessionStarts: any[] = [];
      transport.on('session:start', (d: any) => sessionStarts.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callSid: 'CA123', codec: 'opus', customParameters: {} },
        })),
      );

      expect(sessionStarts[0].codec).toBe('opus');
      expect(sessionStarts[0].sampleRate).toBe(8000);
    });

    it('should emit audio:received on media message', async () => {
      const mockWs = createMockWs();
      const audioEvents: any[] = [];
      transport.on('audio:received', (d: any) => audioEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'media',
          streamSid: 'MS123',
          media: { payload: Buffer.from([0x00, 0x01]).toString('base64'), timestamp: '123' },
          track: 'inbound',
        })),
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
      transport.on('session:end', (d: any) => sessionEnds.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
        })),
      );
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'stop',
          stop: { callSid: 'CA123' },
        })),
      );

      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0]).toMatchObject({ sessionId: 'CA123' });
      expect(transport.getCallSid()).toBeNull();
    });

    it('should handle stop message with callId', async () => {
      const mockWs = createMockWs();
      const sessionEnds: any[] = [];
      transport.on('session:end', (d: any) => sessionEnds.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callId: 'call-456', codec: 'mulaw', customParameters: {} },
        })),
      );
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'stop',
          stop: { callId: 'call-456' },
        })),
      );

      expect(sessionEnds[0].sessionId).toBe('call-456');
    });

    it('should emit mark:played on mark message', async () => {
      const mockWs = createMockWs();
      const markEvents: any[] = [];
      transport.on('mark:played', (d: any) => markEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'mark',
          streamSid: 'MS123',
          mark: { name: 'test-mark' },
        })),
      );

      expect(markEvents.length).toBe(1);
      expect(markEvents[0]).toMatchObject({ streamSid: 'MS123' });
    });

    it('should emit mark:played with streamId fallback', async () => {
      const mockWs = createMockWs();
      const markEvents: any[] = [];
      transport.on('mark:played', (d: any) => markEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'mark',
          streamId: 'stream-789',
          mark: { name: 'test-mark' },
        })),
      );

      expect(markEvents[0].streamSid).toBe('stream-789');
    });

    it('should emit dtmf:received on dtmf message', async () => {
      const mockWs = createMockWs();
      const dtmfEvents: any[] = [];
      transport.on('dtmf:received', (d: any) => dtmfEvents.push(d));

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'dtmf',
          streamSid: 'MS123',
          dtmf: { digit: '7' },
        })),
      );

      expect(dtmfEvents.length).toBe(1);
      expect(dtmfEvents[0].digit).toBe('7');
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
    it('should send audio via WebSocket', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
        })),
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
      expect(sent.event).toBe('media');
      expect(sent.streamSid).toBe('MS123');
      expect(typeof sent.media.payload).toBe('string');
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
  });

  describe('sendMark', () => {
    it('should send mark message and return mark name', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
        })),
      );

      const markName = await transport.sendMark();

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.event).toBe('mark');
      expect(sent.mark.name).toBe(markName);
    });

    it('should return empty string when not connected', async () => {
      const name = await transport.sendMark();
      expect(name).toBe('');
    });
  });

  describe('clearAudio', () => {
    it('should send clear command', async () => {
      const mockWs = createMockWs();

      await transport.acceptConnection(mockWs as any);
      (mockWs as any)._simulateMessage(
        Buffer.from(JSON.stringify({
          event: 'start',
          start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
        })),
      );

      transport.setTTSPlaying(true);
      await transport.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.event).toBe('clear');
      expect(transport.isTTSActive()).toBe(false);
    });

    it('should not clear when not connected', async () => {
      await transport.clearAudio();
    });
  });

  describe('Barge-in', () => {
    it('should trigger barge-in after min duration', () => {
      const custom = new SignalWireTransport({ bargeInEnabled: true, minSpeechDuration: 0, confidenceThreshold: 0.5, silenceThreshold: 0.3 });
      custom.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      custom.on('barge-in:detected', (d: any) => bargeInEvents.push(d));

      custom.onInterimTranscript('hello', 0.9);
      custom.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });
  });

  describe('Static utilities', () => {
    it('should encode buffer to base64', () => {
      const buf = Buffer.from([0x00, 0x01, 0x02]);
      expect(SignalWireTransport.encodeForSignalWire(buf)).toBe('AAEC');
    });

    it('should decode base64 to buffer', () => {
      const decoded = SignalWireTransport.decodeFromSignalWire('AAEC');
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
});
