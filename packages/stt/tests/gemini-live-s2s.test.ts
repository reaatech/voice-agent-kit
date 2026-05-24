import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastWsInstance: any = null;

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((data: any) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;

    constructor(url: string, opts?: any) {
      lastWsInstance = this;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      });
    }

    on(event: string, handler: Function) {
      if (event === 'open') this.onopen = handler as () => void;
      else if (event === 'message') this.onmessage = handler as (data: any) => void;
      else if (event === 'close') this.onclose = handler as () => void;
      else if (event === 'error') this.onerror = handler as (err: any) => void;
    }

    send(_data: any) {}
    close(code?: number) {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
    removeAllListeners() {
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
    }
  }
  return { default: MockWebSocket };
});

import { GeminiLiveS2SProvider } from '../src/adapters/gemini-live-s2s.js';

function sendWsMessage(ws: any, msg: Record<string, unknown>) {
  if (ws?.onmessage) {
    ws.onmessage(Buffer.from(JSON.stringify(msg)));
  }
}

async function connectProvider(provider: GeminiLiveS2SProvider) {
  await provider.connect({
    provider: 'gemini-live-s2s',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash-live-001',
    sampleRate: 24000,
  });
}

describe('GeminiLiveS2SProvider', () => {
  let provider: GeminiLiveS2SProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    lastWsInstance = null;
    provider = new GeminiLiveS2SProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('gemini-live-s2s');
      expect(provider.isConnected()).toBe(false);
    });

    it('should merge custom options', () => {
      const custom = new GeminiLiveS2SProvider({ apiUrl: 'custom.api.com', reconnectAttempts: 5 });
      expect((custom as any).options.apiUrl).toBe('custom.api.com');
    });
  });

  describe('connect', () => {
    it('should throw without API key', async () => {
      await expect(
        provider.connect({ provider: 'gemini-live-s2s', apiKey: '', sampleRate: 24000 }),
      ).rejects.toThrow('Gemini API key is required');
    });

    it('should connect with valid config', async () => {
      await connectProvider(provider);
      expect(provider.isConnected()).toBe(true);
    });
  });

  describe('sendAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.sendAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 24000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('Invalid audio chunk'));
    });

    it('should queue audio when not connected', () => {
      provider.sendAudio({
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 24000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      });

      expect((provider as any).audioQueue.length).toBe(1);
    });

    it('should send audio when connected', async () => {
      await connectProvider(provider);

      const sendSpy = vi.spyOn(lastWsInstance, 'send');

      provider.sendAudio({
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
        sampleRate: 24000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      });

      expect(sendSpy).toHaveBeenCalled();
      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent.realtime_input).toBeDefined();
      expect(sent.realtime_input.media_chunks[0].mime_type).toBe('audio/pcm');
    });
  });

  describe('message handling', () => {
    it('should handle setupComplete', async () => {
      await connectProvider(provider);

      sendWsMessage(lastWsInstance, { setupComplete: true });

      expect((provider as any).isProcessingTurn).toBe(false);
    });

    it('should handle serverContent with modelTurn text', async () => {
      await connectProvider(provider);
      const transcriptCb = vi.fn();
      provider.onTranscript(transcriptCb);

      sendWsMessage(lastWsInstance, {
        serverContent: {
          modelTurn: {
            parts: [{ text: 'Hello from Gemini' }],
          },
        },
      });

      expect(transcriptCb).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'Hello from Gemini', confidence: 0.9, isFinal: false }),
      );
    });

    it('should handle serverContent with audio output', async () => {
      await connectProvider(provider);
      const audioOutputCb = vi.fn();
      provider.onAudioOutput(audioOutputCb);

      sendWsMessage(lastWsInstance, {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm',
                  data: Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64'),
                },
              },
            ],
          },
        },
      });

      expect(audioOutputCb).toHaveBeenCalled();
      expect((provider as any).outputState.chunks.length).toBe(1);
    });

    it('should handle serverContent with turnComplete', async () => {
      await connectProvider(provider);
      const turnCompleteCb = vi.fn();
      provider.onTurnComplete(turnCompleteCb);

      sendWsMessage(lastWsInstance, {
        serverContent: {
          modelTurn: {
            parts: [{ text: 'Final response' }],
          },
          turnComplete: true,
        },
      });

      expect(turnCompleteCb).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Final response',
          confidence: 0.95,
        }),
      );
    });

    it('should handle interrupted', async () => {
      await connectProvider(provider);
      const endOfTurnCb = vi.fn();
      provider.onEndOfTurn(endOfTurnCb);

      (provider as any).isProcessingTurn = true;

      sendWsMessage(lastWsInstance, {
        serverContent: { interrupted: true },
      });

      expect((provider as any).isProcessingTurn).toBe(false);
      expect(endOfTurnCb).toHaveBeenCalled();
    });

    it('should handle function call', async () => {
      await connectProvider(provider);

      sendWsMessage(lastWsInstance, {
        toolCall: {
          functionCalls: [{ name: 'get_weather', args: { city: 'London' } }],
        },
      });

      expect((provider as any).toolCallsDuringTurn).toEqual([
        { name: 'get_weather', arguments: { city: 'London' } },
      ]);
    });

    it('should handle error messages', async () => {
      await connectProvider(provider);
      const errorCb = vi.fn();
      provider.onError(errorCb);

      sendWsMessage(lastWsInstance, {
        error: { message: 'Gemini error' },
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('Gemini error'));
    });
  });

  describe('callback registration', () => {
    it('should register all callbacks', () => {
      expect(() => {
        provider.onAudioOutput(vi.fn());
        provider.onTranscript(vi.fn());
        provider.onTurnComplete(vi.fn());
        provider.onError(vi.fn());
        provider.onEndOfTurn(vi.fn());
      }).not.toThrow();
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      await connectProvider(provider);
      expect(provider.isConnected()).toBe(true);

      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect((provider as any).audioQueue).toEqual([]);
      expect((provider as any).outputState.chunks).toEqual([]);
      expect((provider as any).currentTranscript).toBe('');
      expect((provider as any).isProcessingTurn).toBe(false);
    });

    it('should close WebSocket gracefully', async () => {
      await connectProvider(provider);
      const closeSpy = vi.spyOn(lastWsInstance, 'close');

      await provider.close();

      expect(closeSpy).toHaveBeenCalledWith(1000);
    });
  });

  describe('isConnected', () => {
    it('should return correct state', async () => {
      expect(provider.isConnected()).toBe(false);
      await connectProvider(provider);
      expect(provider.isConnected()).toBe(true);
      await provider.close();
      expect(provider.isConnected()).toBe(false);
    });
  });
});
