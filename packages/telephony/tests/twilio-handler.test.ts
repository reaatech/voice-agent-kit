import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwilioMediaStreamHandler } from '../src/twilio-handler.js';

describe('TwilioMediaStreamHandler', () => {
  let handler: TwilioMediaStreamHandler;

  beforeEach(() => {
    handler = new TwilioMediaStreamHandler();
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

      expect(events[0]).toEqual(expect.objectContaining({
        callSid: 'CA123',
        streamSid: 'MS123',
      }));
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

      expect(endEvents[0]).toEqual(expect.objectContaining({
        callSid: 'CA123',
      }));
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

      expect(markEvents[0]).toEqual(expect.objectContaining({
        streamSid: 'MS123',
      }));
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
    it('should accept WebSocket connection', () => {
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
      // Simulate open event to resolve the promise
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
          if (event === 'message') cb(Buffer.from(JSON.stringify({
            event: 'start',
            start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
          })));
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

    it('should clear audio via WebSocket', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify({
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

      expect(mockWs.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.event).toBe('clear');
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
  });

  describe('TTS State Management', () => {
    it('should track TTS playing state', () => {
      handler.setTTSPlaying(true);
      expect(handler.isTTSActive()).toBe(true);

      handler.setTTSPlaying(false);
      expect(handler.isTTSActive()).toBe(false);
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

  describe('Mark Message Sending', () => {
    it('should send mark message and return mark name', async () => {
      const mockWs = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'open') cb();
          if (event === 'message') cb(Buffer.from(JSON.stringify({
            event: 'start',
            start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
          })));
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
          if (event === 'message') cb(Buffer.from(JSON.stringify({
            event: 'start',
            start: { callSid: 'CA123', streamSid: 'MS123', codec: 'mulaw', customParameters: {} },
          })));
        }),
        off: vi.fn(),
        send: vi.fn(),
      } as any;

      handler.acceptConnection(mockWs);

      const markName1 = await handler.sendMark();
      const markName2 = await handler.sendMark();

      expect(markName1).not.toBe(markName2);
    });
  });

  describe('close', () => {
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
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
    });
  });
});
