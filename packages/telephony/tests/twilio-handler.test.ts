import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwilioMediaStreamHandler } from '../src/twilio-handler.js';
import type { AudioChunk } from '@reaatech/voice-agent-core';

function createMockWs(handlers?: {
  onOpen?: () => void;
  onMessage?: (data: Buffer) => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
}) {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const mock = {
    readyState: 1,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
      if (event === 'open' && handlers?.onOpen) {
        handlers.onOpen();
        cb();
      }
      if (event === 'message' && handlers?.onMessage) {
        const msg = handlers.onMessage;
        Promise.resolve().then(() => msg);
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

describe('TwilioMediaStreamHandler', () => {
  let handler: TwilioMediaStreamHandler;

  beforeEach(() => {
    handler = new TwilioMediaStreamHandler();
  });

  describe('Transport interface compliance', () => {
    it('should have correct name', () => {
      expect(handler.name).toBe('twilio');
    });

    it('should start disconnected', () => {
      expect(handler.isConnected).toBe(false);
    });

    it('should implement Transport interface methods', () => {
      expect(typeof handler.acceptConnection).toBe('function');
      expect(typeof handler.sendAudio).toBe('function');
      expect(typeof handler.clearAudio).toBe('function');
      expect(typeof handler.close).toBe('function');
      expect(typeof handler.getSessionId).toBe('function');
    });
  });

  describe('Message Parsing', () => {
    it('should parse start message via WebSocket', () => {
      const startMessage = {
        event: 'start',
        start: {
          callSid: 'CA123',
          streamSid: 'MS123',
          codec: 'mulaw',
          customParameters: {},
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      const events: any[] = [];
      handler.on('call:start', (data: any) => events.push(data));

      handler.acceptConnection(mockWs);

      expect(events[0]).toEqual(
        expect.objectContaining({
          callSid: 'CA123',
          streamSid: 'MS123',
        }),
      );
    });

    it('should parse media message via WebSocket', () => {
      const mediaMessage = {
        event: 'media',
        media: {
          payload: 'AAAAAAAAAAA=',
          timestamp: '1234567890',
          sequenceNumber: '0',
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(mediaMessage)));
        }),
        off: vi.fn(),
      } as any;

      const audioEvents: any[] = [];
      handler.on('audio:received', (data: any) => audioEvents.push(data));

      handler.acceptConnection(mockWs);

      expect(audioEvents.length).toBe(1);
      expect(audioEvents[0].encoding).toBe('mulaw');
      expect(audioEvents[0].sampleRate).toBe(8000);
    });

    it('should parse stop message via WebSocket', () => {
      const stopMessage = {
        event: 'stop',
        stop: {
          callSid: 'CA123',
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'message') cb(Buffer.from(JSON.stringify(stopMessage)));
        }),
        off: vi.fn(),
      } as any;

      const endEvents: any[] = [];
      handler.on('call:end', (data: any) => endEvents.push(data));

      handler.acceptConnection(mockWs);

      expect(endEvents[0]).toEqual(
        expect.objectContaining({
          callSid: 'CA123',
        }),
      );
    });

    it('should parse mark message via WebSocket', () => {
      const markMessage = {
        event: 'mark',
        streamSid: 'MS123',
        mark: {
          name: 'test-mark',
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'message') cb(Buffer.from(JSON.stringify(markMessage)));
        }),
        off: vi.fn(),
      } as any;

      const markEvents: any[] = [];
      handler.on('mark:played', (data: any) => markEvents.push(data));

      handler.acceptConnection(mockWs);

      expect(markEvents[0]).toEqual(
        expect.objectContaining({
          streamSid: 'MS123',
        }),
      );
    });

    it('should emit error on malformed JSON', () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from('not valid json'));
        }),
        off: vi.fn(),
      } as any;

      const errorEvents: any[] = [];
      handler.on('error', (data: any) => errorEvents.push(data));

      handler.acceptConnection(mockWs);

      expect(errorEvents.length).toBe(1);
    });
  });

  describe('Call Lifecycle', () => {
    it('should track call SID after start message', () => {
      const startMessage = {
        event: 'start',
        start: {
          callSid: 'CA123',
          streamSid: 'MS123',
          codec: 'mulaw',
          customParameters: {},
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      expect(handler.getCallSid()).toBe('CA123');
      expect(handler.getStreamSid()).toBe('MS123');
    });

    it('should emit connected event on accept', () => {
      const mockWs = createMockWs();
      const events: boolean[] = [];
      handler.on('connected', () => events.push(true));

      handler.acceptConnection(mockWs as any);
      expect(events.length).toBe(1);
    });

    it('should emit disconnected event on close', async () => {
      const mockWs = createMockWs();
      const events: boolean[] = [];
      handler.on('disconnected', () => events.push(true));

      await handler.acceptConnection(mockWs as any);
      (mockWs as any)._simulateClose();

      expect(events.length).toBe(1);
      expect(handler.isConnected).toBe(false);
    });

    it('should emit session:start and call:start on start message', () => {
      const startMessage = {
        event: 'start',
        start: {
          callSid: 'CA123',
          streamSid: 'MS123',
          codec: { name: 'mulaw', payload_type: 0, clock_rate: 8000 },
          customParameters: { foo: 'bar' },
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      const sessionStarts: any[] = [];
      handler.on('session:start', (d: any) => sessionStarts.push(d));

      handler.acceptConnection(mockWs);

      expect(sessionStarts.length).toBe(1);
      expect(sessionStarts[0]).toMatchObject({
        sessionId: 'CA123',
        codec: 'mulaw',
        sampleRate: 8000,
      });
    });

    it('should emit session:end and call:end on stop message', () => {
      const startMessage = {
        event: 'start',
        start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
      };
      const stopMessage = {
        event: 'stop',
        stop: { callSid: 'CA123' },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
        }),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
        send: vi.fn(),
        pong: vi.fn(),
      } as any;

      const sessionEnds: any[] = [];
      const callEnds: any[] = [];
      handler.on('session:end', (d: any) => sessionEnds.push(d));
      handler.on('call:end', (d: any) => callEnds.push(d));

      handler.acceptConnection(mockWs);

      const msgCb = mockWs.on.mock.calls.find((c: any[]) => c[0] === 'message');
      if (msgCb) {
        msgCb[1](Buffer.from(JSON.stringify(startMessage)));
        msgCb[1](Buffer.from(JSON.stringify(stopMessage)));
      }

      expect(sessionEnds.length).toBe(1);
      expect(sessionEnds[0]).toMatchObject({ sessionId: 'CA123' });
      expect(callEnds.length).toBe(1);
    });

    it('should emit dtmf:received on dtmf message', () => {
      const dtmfMessage = {
        event: 'dtmf',
        streamSid: 'MS123',
        dtmf: { digit: '5' },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(dtmfMessage)));
        }),
        off: vi.fn(),
      } as any;

      const dtmfEvents: any[] = [];
      handler.on('dtmf:received', (d: any) => dtmfEvents.push(d));

      handler.acceptConnection(mockWs);

      expect(dtmfEvents.length).toBe(1);
      expect(dtmfEvents[0]).toMatchObject({ digit: '5', streamSid: 'MS123' });
    });

    it('should handle codec being a string in start message', () => {
      const startMessage = {
        event: 'start',
        start: {
          callSid: 'CA123',
          streamSid: 'MS123',
          codec: 'opus',
          customParameters: {},
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      const sessionStarts: any[] = [];
      handler.on('session:start', (d: any) => sessionStarts.push(d));

      handler.acceptConnection(mockWs);

      expect(sessionStarts[0].codec).toBe('opus');
      expect(sessionStarts[0].sampleRate).toBe(8000);
    });

    it('should use callSid as fallback when streamSid is missing', () => {
      const startMessage = {
        event: 'start',
        start: {
          callSid: 'CA123',
          codec: 'mulaw',
          customParameters: {},
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);
      expect(handler.getStreamSid()).toBe('CA123');
    });
  });

  describe('Audio Format Utilities', () => {
    it('should encode audio buffer to base64', () => {
      const audioBuffer = Buffer.from([0x00, 0x01, 0x02]);
      const encoded = TwilioMediaStreamHandler.encodeForTwilio(audioBuffer);
      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');
      expect(encoded).toBe('AAEC');
    });

    it('should decode base64 audio to buffer', () => {
      const base64Audio = 'AAEC';
      const decoded = TwilioMediaStreamHandler.decodeFromTwilio(base64Audio);
      expect(decoded).toBeInstanceOf(Buffer);
      expect(decoded).toEqual(Buffer.from([0x00, 0x01, 0x02]));
    });
  });

  describe('WebSocket Connection', () => {
    it('should accept WebSocket connection on open', () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
        }),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
      } as any;

      const connectedEvents: any[] = [];
      handler.on('connected', () => connectedEvents.push(true));

      handler.acceptConnection(mockWs);

      expect(connectedEvents.length).toBe(1);
    });

    it('should accept WebSocket connection when already open', async () => {
      const mockWs = {
        readyState: 1,
        on: vi.fn((event: string, cb: any) => {
          if (event === 'message') cb(Buffer.from(JSON.stringify({
            event: 'start',
            start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
          })));
        }),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
        send: vi.fn(),
        pong: vi.fn(),
      } as any;

      await handler.acceptConnection(mockWs);
      expect(handler.isConnected).toBe(true);
    });

    it('should handle WebSocket error', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'error') cb(new Error('Connection refused'));
        }),
        off: vi.fn(),
      } as any;

      const errors: any[] = [];
      handler.on('error', (err: any) => errors.push(err));

      await expect(handler.acceptConnection(mockWs)).rejects.toThrow('Connection refused');
      expect(errors.length).toBe(1);
    });

    it('should handle ping', () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'ping') cb();
        }),
        off: vi.fn(),
        pong: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);
      expect(mockWs.pong).toHaveBeenCalled();
    });

    it('should close WebSocket connection', async () => {
      let openCallback: (() => void) | null = null;
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open' && cb) openCallback = cb;
        }),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
      } as any;

      const connectionPromise = handler.acceptConnection(mockWs);
      if (openCallback) openCallback();
      await connectionPromise;

      await handler.close();

      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('Audio Sending', () => {
    it('should send audio via WebSocket', () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message')
            cb(
              Buffer.from(
                JSON.stringify({
                  event: 'start',
                  start: {
                    callSid: 'CA123',
                    streamSid: 'MS123',
                    codec: 'mulaw',
                    customParameters: {},
                  },
                }),
              ),
            );
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      const chunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };

      handler.sendAudio(chunk);

      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.event).toBe('media');
      expect(sentMessage.streamSid).toBe('MS123');
    });

    it('should not send audio when not connected', () => {
      const mockWs = { on: vi.fn(), off: vi.fn(), send: vi.fn() } as any;
      const chunk = {
        buffer: Buffer.from([0x00]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };
      handler.sendAudio(chunk);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('should not send audio when no streamSid', () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => { if (event === 'open') cb(); }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      const chunk = {
        buffer: Buffer.from([0x00]),
        sampleRate: 8000,
        encoding: 'mulaw' as const,
        channels: 1,
        timestamp: Date.now(),
      };
      handler.sendAudio(chunk);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('should clear audio via WebSocket', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message')
            cb(
              Buffer.from(
                JSON.stringify({
                  event: 'start',
                  start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
                }),
              ),
            );
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);
      handler.setTTSPlaying(true);

      await handler.clearAudio();

      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.event).toBe('clear');
      expect(handler.isTTSActive()).toBe(false);
    });

    it('should not clear audio when not connected', async () => {
      await handler.clearAudio();
    });

    it('should not clear audio when no streamSid', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => { if (event === 'open') cb(); }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;
      handler.acceptConnection(mockWs);
      await handler.clearAudio();
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('Mark Message Sending', () => {
    it('should send mark message and return mark name', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message')
            cb(
              Buffer.from(
                JSON.stringify({
                  event: 'start',
                  start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
                }),
              ),
            );
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      const markName = await handler.sendMark();

      expect(markName).toMatch(/^mark-\d+$/);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.event).toBe('mark');
      expect(sentMessage.mark.name).toBe(markName);
    });

    it('should return empty string when not connected', async () => {
      const markName = await handler.sendMark();
      expect(markName).toBe('');
    });

    it('should increment mark IDs sequentially', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message')
            cb(
              Buffer.from(
                JSON.stringify({
                  event: 'start',
                  start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
                }),
              ),
            );
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      const markName1 = await handler.sendMark();
      const markName2 = await handler.sendMark();

      expect(markName1).not.toBe(markName2);
    });

    it('should return empty string when no streamSid', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => { if (event === 'open') cb(); }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;
      handler.acceptConnection(mockWs);
      const markName = await handler.sendMark();
      expect(markName).toBe('');
    });
  });

  describe('Barge-in Configuration', () => {
    it('should report barge-in disabled by default', () => {
      expect(handler.isBargeInEnabled()).toBe(false);
    });

    it('should report configured barge-in thresholds', () => {
      const thresholds = handler.getBargeInThresholds();
      expect(thresholds).toEqual({
        minSpeechDuration: 300,
        confidenceThreshold: 0.7,
        silenceThreshold: 0.3,
      });
    });

    it('should accept barge-in config on construction', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 500,
        confidenceThreshold: 0.8,
        silenceThreshold: 0.5,
      });

      expect(configuredHandler.isBargeInEnabled()).toBe(true);
      const thresholds = configuredHandler.getBargeInThresholds();
      expect(thresholds.minSpeechDuration).toBe(500);
      expect(thresholds.confidenceThreshold).toBe(0.8);
      expect(thresholds.silenceThreshold).toBe(0.5);
    });
  });

  describe('Barge-in Detection', () => {
    it('should not trigger barge-in when TTS is not playing', () => {
      const bargeInEvents: any[] = [];
      handler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      handler.onInterimTranscript('hello', 0.9);

      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in when disabled', () => {
      handler.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      handler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      handler.onInterimTranscript('hello', 0.9);

      expect(bargeInEvents.length).toBe(0);
    });

    it('should not trigger barge-in with low confidence', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 100,
        confidenceThreshold: 0.8,
        silenceThreshold: 0.3,
      });

      configuredHandler.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      configuredHandler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      configuredHandler.onInterimTranscript('hello', 0.5);

      expect(bargeInEvents.length).toBe(0);
    });

    it('should trigger barge-in when speech exceeds min duration', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      configuredHandler.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      configuredHandler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      configuredHandler.onInterimTranscript('hello', 0.9);
      configuredHandler.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
      expect(bargeInEvents[0]).toMatchObject({
        callSid: null,
        streamSid: null,
      });
      expect(typeof bargeInEvents[0].timestamp).toBe('number');
      expect(configuredHandler.isTTSActive()).toBe(false);
    });

    it('should reset speech start time on empty transcript', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      configuredHandler.setTTSPlaying(true);

      configuredHandler.onInterimTranscript('hello', 0.9);
      configuredHandler.onInterimTranscript('', 0.9);

      const bargeInEvents: any[] = [];
      configuredHandler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      configuredHandler.onInterimTranscript('world', 0.9);
      configuredHandler.onInterimTranscript('world again', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });

    it('should not trigger barge-in after already triggered', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      configuredHandler.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      configuredHandler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      configuredHandler.onInterimTranscript('hello', 0.9);
      configuredHandler.onInterimTranscript('hello world', 0.9);
      configuredHandler.onInterimTranscript('more speech', 0.9);

      expect(bargeInEvents.length).toBe(1);
    });

    it('should reset barge-in state when TTS playing is set to false', () => {
      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 100,
        confidenceThreshold: 0.8,
        silenceThreshold: 0.3,
      });

      configuredHandler.setTTSPlaying(true);
      configuredHandler.setTTSPlaying(false);

      expect(configuredHandler.isTTSActive()).toBe(false);
    });

    it('should emit barge-in event with callSid and streamSid when available', () => {
      const startMessage = {
        event: 'start',
        start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      const configuredHandler = new TwilioMediaStreamHandler({
        bargeInEnabled: true,
        minSpeechDuration: 0,
        confidenceThreshold: 0.5,
        silenceThreshold: 0.3,
      });

      configuredHandler.acceptConnection(mockWs);
      configuredHandler.setTTSPlaying(true);

      const bargeInEvents: any[] = [];
      configuredHandler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));

      configuredHandler.onInterimTranscript('hello', 0.9);
      configuredHandler.onInterimTranscript('hello world', 0.9);

      expect(bargeInEvents.length).toBe(1);
      expect(bargeInEvents[0].callSid).toBe('CA123');
      expect(bargeInEvents[0].streamSid).toBe('MS123');
    });
  });

  describe('TTS State Management', () => {
    it('should track TTS playing state', () => {
      handler.setTTSPlaying(true);
      expect(handler.isTTSActive()).toBe(true);

      handler.setTTSPlaying(false);
      expect(handler.isTTSActive()).toBe(false);
    });

    it('should reset barge-in state when TTS stops', () => {
      handler.setTTSPlaying(true);
      handler.onInterimTranscript('hello', 0.9);
      handler.setTTSPlaying(false);

      const bargeInEvents: any[] = [];
      handler.on('barge-in:detected', (data: any) => bargeInEvents.push(data));
      handler.setTTSPlaying(true);
      handler.onInterimTranscript('world', 0.9);

      expect(bargeInEvents.length).toBe(0);
    });
  });

  describe('DTMF Handling', () => {
    it('should parse DTMF message via WebSocket', () => {
      const dtmfMessage = {
        event: 'dtmf',
        streamSid: 'MS123',
        dtmf: {
          digit: '5',
          duration: 100,
        },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(dtmfMessage)));
        }),
        off: vi.fn(),
      } as any;

      const dtmfEvents: any[] = [];
      handler.on('dtmf:received', (data: any) => dtmfEvents.push(data));

      handler.acceptConnection(mockWs);

      expect(dtmfEvents.length).toBe(1);
      expect(dtmfEvents[0].digit).toBe('5');
      expect(dtmfEvents[0].streamSid).toBe('MS123');
    });
  });

  describe('close', () => {
    it('should close WebSocket connection and clean up', async () => {
      let openCallback: (() => void) | null = null;
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open' && cb) openCallback = cb;
        }),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
      } as any;

      const connectionPromise = handler.acceptConnection(mockWs);
      if (openCallback) openCallback();
      await connectionPromise;

      await handler.close();

      expect(mockWs.close).toHaveBeenCalled();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(handler.isConnected).toBe(false);
      expect(handler.getCallSid()).toBeNull();
      expect(handler.getStreamSid()).toBeNull();
    });

    it('should handle close when not connected', async () => {
      await handler.close();
    });

    it('should handle close when ws is null', async () => {
      await handler.close();
      expect(handler.isConnected).toBe(false);
    });
  });

  describe('Session ID', () => {
    it('should return callSid as session ID', () => {
      const startMessage = {
        event: 'start',
        start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
      };

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify(startMessage)));
        }),
        off: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);
      expect(handler.getSessionId()).toBe('CA123');
    });

    it('should return null when no call is active', () => {
      expect(handler.getSessionId()).toBeNull();
    });
  });

  describe('clearAudio resets state', () => {
    it('should reset TTS playing and barge-in state', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message')
            cb(Buffer.from(JSON.stringify({
              event: 'start',
              start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
            })));
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);
      handler.setTTSPlaying(true);

      await handler.clearAudio();

      expect(handler.isTTSActive()).toBe(false);
    });
  });

  describe('Buffer handling', () => {
    it('should handle ArrayBuffer data', () => {
      const startMsg = JSON.stringify({
        event: 'start',
        start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
      });
      const encoder = new TextEncoder();
      const arrBuf = encoder.encode(startMsg).buffer;

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(arrBuf);
        }),
        off: vi.fn(),
      } as any;

      const sessionStarts: any[] = [];
      handler.on('session:start', (d: any) => sessionStarts.push(d));
      handler.acceptConnection(mockWs);

      expect(sessionStarts.length).toBe(1);
    });

    it('should handle Buffer array data', () => {
      const startMsg = JSON.stringify({
        event: 'start',
        start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
      });

      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb([Buffer.from(startMsg)]);
        }),
        off: vi.fn(),
      } as any;

      const sessionStarts: any[] = [];
      handler.on('session:start', (d: any) => sessionStarts.push(d));
      handler.acceptConnection(mockWs);

      expect(sessionStarts.length).toBe(1);
    });
  });
});
