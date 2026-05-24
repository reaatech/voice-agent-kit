import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { S2SPipelineDependencies, S2SProvider } from '../src/pipeline/s2s-pipeline.js';
import {
  createSpeechToSpeechPipeline,
  SpeechToSpeechPipeline,
} from '../src/pipeline/s2s-pipeline.js';
import type { AgentResponse, AudioChunk, Utterance } from '../src/types/index.js';

function createMockS2SProvider(): S2SProvider & {
  triggerAudioOutput: (chunk: AudioChunk) => void;
  triggerTranscript: (utterance: Utterance) => void;
  triggerTurnComplete: (response: AgentResponse) => void;
  triggerEndOfTurn: () => void;
  triggerError: (error: Error) => void;
} {
  let audioCb: ((chunk: AudioChunk) => void) | undefined;
  let transcriptCb: ((utterance: Utterance) => void) | undefined;
  let turnCompleteCb: ((response: AgentResponse) => void) | undefined;
  let endOfTurnCb: (() => void) | undefined;
  let errorCb: ((error: Error) => void) | undefined;

  const provider: S2SProvider & {
    triggerAudioOutput: (chunk: AudioChunk) => void;
    triggerTranscript: (utterance: Utterance) => void;
    triggerTurnComplete: (response: AgentResponse) => void;
    triggerEndOfTurn: () => void;
    triggerError: (error: Error) => void;
  } = {
    name: 'mock-s2s',
    connect: vi.fn().mockResolvedValue(undefined),
    sendAudio: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    onAudioOutput: vi.fn().mockImplementation((cb: (chunk: AudioChunk) => void) => {
      audioCb = cb;
    }),
    onTranscript: vi.fn().mockImplementation((cb: (utterance: Utterance) => void) => {
      transcriptCb = cb;
    }),
    onTurnComplete: vi.fn().mockImplementation((cb: (response: AgentResponse) => void) => {
      turnCompleteCb = cb;
    }),
    onEndOfTurn: vi.fn().mockImplementation((cb: () => void) => {
      endOfTurnCb = cb;
    }),
    onError: vi.fn().mockImplementation((cb: (error: Error) => void) => {
      errorCb = cb;
    }),
    triggerAudioOutput(chunk: AudioChunk) {
      audioCb?.(chunk);
    },
    triggerTranscript(utterance: Utterance) {
      transcriptCb?.(utterance);
    },
    triggerTurnComplete(response: AgentResponse) {
      turnCompleteCb?.(response);
    },
    triggerEndOfTurn() {
      endOfTurnCb?.();
    },
    triggerError(error: Error) {
      errorCb?.(error);
    },
  };

  return provider;
}

function createMockSessionManager() {
  return {
    getSession: vi.fn().mockReturnValue({
      sessionId: 'session-1',
      status: 'active',
      callSid: 'CA123',
      mcpEndpoint: 'https://mcp.example.com',
      sttProvider: 'deepgram',
      ttsProvider: 'deepgram',
      turns: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
      ttl: 3600,
      metadata: {},
    }),
    getConversationHistory: vi.fn().mockReturnValue([]),
    addTurn: vi.fn().mockReturnValue({
      turnId: 'turn-1',
      userUtterance: 'Hello',
      agentResponse: 'Hi',
      timestamp: new Date(),
      latencyMs: 100,
    }),
    getAllSessions: vi.fn().mockReturnValue([{ sessionId: 'session-1', status: 'active' }]),
    updateSession: vi.fn(),
  };
}

function createMockLatencyEnforcer() {
  return {
    startTurn: vi.fn(),
    startStage: vi.fn(),
    endStage: vi.fn().mockReturnValue(100),
    endTurn: vi.fn().mockReturnValue({
      sttLatencyMs: 100,
      mcpLatencyMs: 100,
      ttsFirstByteMs: 100,
      totalTurnLatencyMs: 300,
      budgetExceeded: false,
      exceededStages: [],
    }),
  };
}

function createMockConfig() {
  return {
    mcp: { endpoint: 'https://mcp.example.com', timeout: 400 },
    stt: { provider: 'deepgram', sampleRate: 8000 },
    tts: { provider: 'deepgram', speed: 1.0 },
    latency: { total: { target: 800, hardCap: 1200 }, stages: { stt: 200, mcp: 400, tts: 200 } },
    session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
    bargeIn: {
      enabled: true,
      minSpeechDuration: 300,
      confidenceThreshold: 0.7,
      silenceThreshold: 0.3,
    },
    speechToSpeech: { provider: 'openai-realtime' },
    mode: 'speech-to-speech',
  };
}

function createDependencies(): S2SPipelineDependencies {
  return {
    sessionManager:
      createMockSessionManager() as unknown as S2SPipelineDependencies['sessionManager'],
    latencyEnforcer:
      createMockLatencyEnforcer() as unknown as S2SPipelineDependencies['latencyEnforcer'],
    provider: createMockS2SProvider() as unknown as S2SPipelineDependencies['provider'],
    config: createMockConfig() as unknown as S2SPipelineDependencies['config'],
  };
}

describe('SpeechToSpeechPipeline', () => {
  let pipeline: SpeechToSpeechPipeline;
  let provider: ReturnType<typeof createMockS2SProvider>;

  beforeEach(() => {
    const deps = createDependencies();
    provider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
    pipeline = new SpeechToSpeechPipeline(deps);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  describe('constructor', () => {
    it('should create a pipeline instance', () => {
      expect(pipeline).toBeInstanceOf(SpeechToSpeechPipeline);
    });

    it('should set up provider listeners', () => {
      expect(provider.onAudioOutput).toHaveBeenCalled();
      expect(provider.onTranscript).toHaveBeenCalled();
      expect(provider.onTurnComplete).toHaveBeenCalled();
      expect(provider.onEndOfTurn).toHaveBeenCalled();
      expect(provider.onError).toHaveBeenCalled();
    });
  });

  describe('startSession', () => {
    it('should emit pipeline:start event', async () => {
      const startHandler = vi.fn();
      pipeline.on('pipeline:start', startHandler);

      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      expect(startHandler).toHaveBeenCalled();
    });

    it('should connect the S2S provider', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      expect(provider.connect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai-realtime' }),
      );
    });

    it('should throw error when s2s config is missing', async () => {
      const deps = createDependencies();
      (deps.config as any).speechToSpeech = undefined;
      const p = new SpeechToSpeechPipeline(deps);

      await expect(p.startSession({ sessionId: 'session-1', status: 'active' })).rejects.toThrow(
        'SpeechToSpeech config is required',
      );
      p.destroy();
    });

    it('should emit error on provider connect failure', async () => {
      (provider.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('S2S connection failed'),
      );

      const errorHandler = vi.fn();
      pipeline.on('pipeline:error', errorHandler);

      await expect(
        pipeline.startSession({ sessionId: 'session-1', status: 'active' }),
      ).rejects.toThrow('S2S connection failed');

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('processAudioChunk', () => {
    it('should route audio to the S2S provider', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      await pipeline.processAudioChunk('session-1', chunk);

      expect(provider.sendAudio).toHaveBeenCalledWith(chunk);
    });

    it('should emit error for non-existent session', async () => {
      const deps = createDependencies();
      (deps.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const p = new SpeechToSpeechPipeline(deps);

      const errorHandler = vi.fn();
      p.on('pipeline:error', errorHandler);

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      await p.processAudioChunk('session-1', chunk);

      expect(errorHandler).toHaveBeenCalled();
      p.destroy();
    });

    it('should emit error for inactive session', async () => {
      const deps = createDependencies();
      (deps.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'session-1',
        status: 'closed',
      });
      const p = new SpeechToSpeechPipeline(deps);

      const errorHandler = vi.fn();
      p.on('pipeline:error', errorHandler);

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      await p.processAudioChunk('session-1', chunk);

      expect(errorHandler).toHaveBeenCalled();
      p.destroy();
    });
  });

  describe('event emission', () => {
    it('should emit tts:chunk for audio output from provider', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const chunkHandler = vi.fn();
      pipeline.on('pipeline:tts:chunk', chunkHandler);

      const audioChunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };
      provider.triggerAudioOutput(audioChunk);

      expect(chunkHandler).toHaveBeenCalled();
      expect(chunkHandler.mock.calls[0][0].data.chunkSize).toBe(1);
    });

    it('should not emit tts:chunk when session is not active', async () => {
      const deps = createDependencies();
      (deps.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      (deps.sessionManager.getAllSessions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const localProvider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
      const p = new SpeechToSpeechPipeline(deps);

      await p.startSession({ sessionId: 'session-1', status: 'active' });
      // Stop session
      (deps.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      (deps.sessionManager.getAllSessions as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const chunkHandler = vi.fn();
      p.on('pipeline:tts:chunk', chunkHandler);

      const audioChunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };
      localProvider.triggerAudioOutput(audioChunk);

      expect(chunkHandler).not.toHaveBeenCalled();
      p.destroy();
    });

    it('should emit stt:interim for non-final transcripts', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const interimHandler = vi.fn();
      pipeline.on('pipeline:stt:interim', interimHandler);

      provider.triggerTranscript({
        transcript: 'hello',
        isFinal: false,
        confidence: 0.8,
        timestamp: Date.now(),
      });

      expect(interimHandler).toHaveBeenCalled();
    });

    it('should emit stt:final for final transcripts', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const finalHandler = vi.fn();
      pipeline.on('pipeline:stt:final', finalHandler);

      provider.triggerTranscript({
        transcript: 'hello world',
        isFinal: true,
        confidence: 0.95,
        timestamp: Date.now(),
      });

      expect(finalHandler).toHaveBeenCalled();
    });

    it('should emit stt:eos on end of turn', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const eosHandler = vi.fn();
      pipeline.on('pipeline:stt:eos', eosHandler);

      provider.triggerEndOfTurn();

      expect(eosHandler).toHaveBeenCalled();
    });

    it('should emit error on provider error', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const errorHandler = vi.fn();
      pipeline.on('pipeline:error', errorHandler);

      provider.triggerError(new Error('S2S provider error'));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('turn completion', () => {
    it('should emit mcp:response, tts:start, tts:complete, turn:end on turn complete', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const events: string[] = [];
      pipeline.on('pipeline:mcp:response', () => events.push('mcp:response'));
      pipeline.on('pipeline:tts:start', () => events.push('tts:start'));
      pipeline.on('pipeline:tts:complete', () => events.push('tts:complete'));
      pipeline.on('pipeline:turn:end', () => events.push('turn:end'));

      provider.triggerTurnComplete({
        text: 'S2S response text',
        toolCalls: [],
        latencyMs: 150,
        confidence: 0.95,
      });

      expect(events).toContain('mcp:response');
      expect(events).toContain('tts:start');
      expect(events).toContain('tts:complete');
      expect(events).toContain('turn:end');
    });

    it('should add turn to session history on completion', async () => {
      const deps = createDependencies();
      const localProvider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
      const addTurnSpy = deps.sessionManager.addTurn as ReturnType<typeof vi.fn>;
      const p = new SpeechToSpeechPipeline(deps);

      await p.startSession({ sessionId: 'session-1', status: 'active' });

      localProvider.triggerTurnComplete({
        text: 'Response text',
        toolCalls: [],
        latencyMs: 150,
      });

      expect(addTurnSpy).toHaveBeenCalled();
      p.destroy();
    });

    it('should not crash when turn complete fires but no session', () => {
      provider.triggerTurnComplete({
        text: 'Response',
        toolCalls: [],
        latencyMs: 50,
      });
    });

    it('should handle turn complete when no active sessions exist', () => {
      const deps = createDependencies();
      (deps.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      (deps.sessionManager.getAllSessions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const localProvider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
      const p = new SpeechToSpeechPipeline(deps);

      expect(() => {
        localProvider.triggerTurnComplete({
          text: 'Response',
          toolCalls: [],
          latencyMs: 50,
        });
      }).not.toThrow();

      p.destroy();
    });
  });

  describe('bargeIn', () => {
    it('should close the S2S provider on barge-in', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      pipeline.bargeIn('session-1');

      expect(provider.close).toHaveBeenCalled();
    });

    it('should close provider on barge-in after turn completion', async () => {
      const deps = createDependencies();
      const localProvider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
      const p = new SpeechToSpeechPipeline(deps);

      await p.startSession({ sessionId: 'session-1', status: 'active' });

      localProvider.triggerTurnComplete({
        text: 'Response',
        toolCalls: [],
        latencyMs: 100,
      });

      p.bargeIn('session-1');

      expect(localProvider.close).toHaveBeenCalled();
      p.destroy();
    });

    it('should not barge-in for a different session', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      const bargeHandler = vi.fn();
      pipeline.on('pipeline:barge_in', bargeHandler);

      pipeline.bargeIn('session-other');

      expect(bargeHandler).not.toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    it('should emit pipeline:end event', async () => {
      const endHandler = vi.fn();
      pipeline.on('pipeline:end', endHandler);

      await pipeline.endSession('session-1');

      expect(endHandler).toHaveBeenCalled();
    });

    it('should close the S2S provider', async () => {
      await pipeline.endSession('session-1');

      expect(provider.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      (provider.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Close failed'));

      const errorHandler = vi.fn();
      pipeline.on('pipeline:error', errorHandler);

      await pipeline.endSession('session-1');

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should clean up turns for the session', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      provider.triggerTurnComplete({
        text: 'Response',
        toolCalls: [],
        latencyMs: 100,
      });

      const endHandler = vi.fn();
      pipeline.on('pipeline:end', endHandler);

      await pipeline.endSession('session-1');

      expect(endHandler).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      pipeline.destroy();
      expect(pipeline.listenerCount('pipeline:start')).toBe(0);
    });

    it('should close provider on destroy when connected', async () => {
      const deps = createDependencies();
      const localProvider = deps.provider as unknown as ReturnType<typeof createMockS2SProvider>;
      const p = new SpeechToSpeechPipeline(deps);

      await p.startSession({ sessionId: 'session-1', status: 'active' });

      p.destroy();

      expect(localProvider.close).toHaveBeenCalled();
    });

    it('should not throw on destroy when not connected', () => {
      const p = new SpeechToSpeechPipeline(createDependencies());
      expect(() => p.destroy()).not.toThrow();
    });
  });

  describe('createSpeechToSpeechPipeline', () => {
    it('should create a pipeline instance', () => {
      const deps = createDependencies();
      const p = createSpeechToSpeechPipeline(deps);
      expect(p).toBeInstanceOf(SpeechToSpeechPipeline);
      p.destroy();
    });
  });
});
