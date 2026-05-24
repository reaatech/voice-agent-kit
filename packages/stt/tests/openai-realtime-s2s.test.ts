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

import { OpenAIRealtimeS2SProvider } from '../src/adapters/openai-realtime-s2s.js';

function sendWsMessage(ws: any, msg: Record<string, unknown>) {
  if (ws?.onmessage) {
    ws.onmessage(Buffer.from(JSON.stringify(msg)));
  }
}

async function connectProvider(provider: OpenAIRealtimeS2SProvider) {
  await provider.connect({
    provider: 'openai-realtime-s2s',
    apiKey: 'test-key',
    model: 'gpt-4o-realtime-preview',
    sampleRate: 24000,
  });
}

describe('OpenAIRealtimeS2SProvider', () => {
  let provider: OpenAIRealtimeS2SProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    lastWsInstance = null;
    provider = new OpenAIRealtimeS2SProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('openai-realtime-s2s');
      expect(provider.isConnected()).toBe(false);
    });

    it('should merge custom options', () => {
      const custom = new OpenAIRealtimeS2SProvider({ apiUrl: 'custom.openai.com', reconnectAttempts: 5 });
      expect((custom as any).options.apiUrl).toBe('custom.openai.com');
    });
  });

  describe('connect', () => {
    it('should throw without API key', async () => {
      await expect(
        provider.connect({ provider: 'openai-realtime-s2s', apiKey: '', sampleRate: 24000 }),
      ).rejects.toThrow('OpenAI API key is required');
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
      expect(sent.type).toBe('input_audio_buffer.append');
      expect(sent.audio).toBeDefined();
    });
  });

  describe('message handling', () => {
    it('should handle speech_started', async () => {
      await connectProvider(provider);
      const endOfTurnCb = vi.fn();
      provider.onEndOfTurn(endOfTurnCb);

      (provider as any).responseInProgress = true;
      sendWsMessage(lastWsInstance, { type: 'input_audio_buffer.speech_started' });

      expect((provider as any).currentTranscript).toBe('');
      expect(endOfTurnCb).toHaveBeenCalled();
    });

    it('should handle transcription completed', async () => {
      await connectProvider(provider);
      const transcriptCb = vi.fn();
      provider.onTranscript(transcriptCb);

      sendWsMessage(lastWsInstance, {
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'hello world',
      });

      expect(transcriptCb).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'hello world', confidence: 0.95, isFinal: true }),
      );
    });

    it('should handle response.created', async () => {
      await connectProvider(provider);

      sendWsMessage(lastWsInstance, { type: 'response.created' });

      expect((provider as any).responseInProgress).toBe(true);
      expect((provider as any).audioTranscriptDeltas).toEqual([]);
    });

    it('should handle response.audio.delta', async () => {
      await connectProvider(provider);
      const audioOutputCb = vi.fn();
      provider.onAudioOutput(audioOutputCb);

      const base64audio = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
      sendWsMessage(lastWsInstance, {
        type: 'response.audio.delta',
        delta: base64audio,
      });

      expect(audioOutputCb).toHaveBeenCalled();
      expect((provider as any).outputBuffer.chunks.length).toBe(1);
    });

    it('should handle audio transcript delta', async () => {
      await connectProvider(provider);
      const transcriptCb = vi.fn();
      provider.onTranscript(transcriptCb);

      sendWsMessage(lastWsInstance, {
        type: 'response.audio_transcript.delta',
        delta: 'Hello ',
      });

      expect(transcriptCb).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'Hello ', confidence: 0.8, isFinal: false }),
      );

      sendWsMessage(lastWsInstance, {
        type: 'response.audio_transcript.delta',
        delta: 'world',
      });

      expect(transcriptCb).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'Hello world', confidence: 0.8, isFinal: false }),
      );
    });

    it('should handle text.delta', async () => {
      await connectProvider(provider);
      const transcriptCb = vi.fn();
      provider.onTranscript(transcriptCb);

      sendWsMessage(lastWsInstance, {
        type: 'response.text.delta',
        delta: 'text response',
      });

      expect(transcriptCb).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: 'text response', confidence: 0.9, isFinal: false }),
      );
    });

    it('should handle function call', async () => {
      await connectProvider(provider);

      sendWsMessage(lastWsInstance, {
        type: 'response.function_call_arguments.done',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"city": "London"}',
      });

      expect((provider as any).toolCallsDuringTurn).toEqual([
        { name: 'get_weather', arguments: { city: 'London' } },
      ]);
    });

    it('should handle response.done with turnComplete', async () => {
      await connectProvider(provider);
      const turnCompleteCb = vi.fn();
      provider.onTurnComplete(turnCompleteCb);

      sendWsMessage(lastWsInstance, {
        type: 'response.audio_transcript.delta',
        delta: 'Final response ',
      });
      sendWsMessage(lastWsInstance, {
        type: 'response.done',
        response: {
          usage: { total_tokens: 50, input_tokens: 20, output_tokens: 30 },
        },
      });

      expect((provider as any).responseInProgress).toBe(false);
      expect(turnCompleteCb).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Final response ',
          confidence: 0.95,
        }),
      );
    });

    it('should handle error messages', async () => {
      await connectProvider(provider);
      const errorCb = vi.fn();
      provider.onError(errorCb);

      sendWsMessage(lastWsInstance, {
        type: 'error',
        error: { message: 'API error' },
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('API error'));
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
      expect((provider as any).outputBuffer.chunks).toEqual([]);
      expect((provider as any).currentTranscript).toBe('');
      expect((provider as any).responseInProgress).toBe(false);
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
