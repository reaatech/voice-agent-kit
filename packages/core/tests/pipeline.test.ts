import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineDependencies } from '../src/pipeline/index.js';
import {
  createPipeline,
  createPipelineForMode,
  Pipeline,
  createSpeechToSpeechPipeline,
} from '../src/pipeline/index.js';
import type { AudioChunk, Utterance } from '../src/types/index.js';
import { ThinkingAudioManager } from '../src/pipeline/thinking-audio.js';

// Mock providers
function createMockSTTProviderWithEndOfSpeech() {
  let onUtteranceCallback: ((utterance: Utterance) => void) | undefined;
  let onEndOfSpeechCallback: (() => void) | undefined;
  return {
    name: 'mock-stt',
    connect: vi.fn().mockResolvedValue(undefined),
    streamAudio: vi.fn().mockImplementation(() => {
      if (onUtteranceCallback) {
        setTimeout(() => {
          onUtteranceCallback?.({
            transcript: 'test',
            isFinal: true,
            confidence: 0.9,
            timestamp: Date.now(),
          });
        }, 0);
      }
    }),
    onUtterance: vi.fn().mockImplementation((cb: (utterance: Utterance) => void) => {
      onUtteranceCallback = cb;
    }),
    onEndOfSpeech: vi.fn().mockImplementation((cb: () => void) => {
      onEndOfSpeechCallback = cb;
    }),
    close: vi.fn().mockResolvedValue(undefined),
    triggerEndOfSpeech() {
      onEndOfSpeechCallback?.();
    },
  };
}

function createMockSTTProvider() {
  let onUtteranceCallback: ((utterance: Utterance) => void) | undefined;
  return {
    name: 'mock-stt',
    connect: vi.fn().mockResolvedValue(undefined),
    streamAudio: vi.fn().mockImplementation(() => {
      if (onUtteranceCallback) {
        setTimeout(() => {
          onUtteranceCallback?.({
            transcript: 'test',
            isFinal: true,
            confidence: 0.9,
            timestamp: Date.now(),
          });
        }, 0);
      }
    }),
    onUtterance: vi.fn().mockImplementation((cb: (utterance: Utterance) => void) => {
      onUtteranceCallback = cb;
    }),
    onEndOfSpeech: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSTTProviderWithInterim() {
  let onUtteranceCallback: ((utterance: Utterance) => void) | undefined;
  let emitted = false;
  return {
    name: 'mock-stt',
    connect: vi.fn().mockResolvedValue(undefined),
    streamAudio: vi.fn().mockImplementation(() => {
      if (onUtteranceCallback && !emitted) {
        emitted = true;
        setTimeout(() => {
          onUtteranceCallback?.({
            transcript: 'test',
            isFinal: false,
            confidence: 0.5,
            timestamp: Date.now(),
          });
        }, 0);
        setTimeout(() => {
          onUtteranceCallback?.({
            transcript: 'test utterance',
            isFinal: true,
            confidence: 0.95,
            timestamp: Date.now(),
          });
        }, 5);
      }
    }),
    onUtterance: vi.fn().mockImplementation((cb: (utterance: Utterance) => void) => {
      onUtteranceCallback = cb;
    }),
    onEndOfSpeech: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTTSProvider() {
  return {
    name: 'mock-tts',
    synthesize: vi.fn().mockImplementation(async function* () {
      yield {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      } as AudioChunk;
    }),
    supportsStreaming: true,
    firstByteLatencyMs: 100,
  };
}

function createSlowTTSProvider() {
  const state = { cancelled: false };
  return {
    name: 'mock-tts-slow',
    synthesize: vi.fn().mockImplementation(async function* () {
      yield {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      } as AudioChunk;
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (state.cancelled) break;
        yield {
          buffer: Buffer.from([0x7f]),
          sampleRate: 8000,
          encoding: 'mulaw',
          channels: 1,
          timestamp: Date.now(),
        } as AudioChunk;
      }
    }),
    supportsStreaming: true,
    firstByteLatencyMs: null,
    cancel: vi.fn().mockImplementation(() => {
      state.cancelled = true;
    }),
  };
}

function createFailingTTSProvider(errorMsg: string) {
  return {
    name: 'mock-tts-fail',
    synthesize: vi.fn().mockImplementation(async function* () {
      throw new Error(errorMsg);
    }),
    supportsStreaming: true,
    firstByteLatencyMs: null,
  };
}

function createMockMCPClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn().mockResolvedValue({
      text: 'Mock response',
      latencyMs: 100,
      toolCalls: [],
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
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
    addTurnHistory: vi.fn(),
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
    getStageBudget: vi.fn().mockReturnValue(200),
    getTotalTargetBudget: vi.fn().mockReturnValue(800),
    getTotalHardCap: vi.fn().mockReturnValue(1200),
    checkStageBudget: vi
      .fn()
      .mockReturnValue({ withinBudget: true, remainingMs: 100, exceeded: false }),
    checkTotalBudget: vi.fn().mockReturnValue({
      withinTarget: true,
      withinHardCap: true,
      remainingTargetMs: 500,
      remainingHardCapMs: 900,
    }),
    on: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn(),
  };
}

function createMockConfig() {
  return {
    mcp: { endpoint: 'https://mcp.example.com', timeout: 400 },
    stt: { provider: 'deepgram', sampleRate: 8000 },
    tts: { provider: 'deepgram', speed: 1.0 },
    latency: {
      total: { target: 800, hardCap: 1200 },
      stages: { stt: 200, mcp: 400, tts: 200 },
    },
    session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
    bargeIn: {
      enabled: true,
      minSpeechDuration: 300,
      confidenceThreshold: 0.7,
      silenceThreshold: 0.3,
    },
  };
}

function createMockVADProvider() {
  return {
    name: 'mock-vad',
    sampleRate: 8000,
    process: vi.fn().mockReturnValue({
      isSpeech: false,
      confidence: 0.0,
      timestamp: Date.now(),
    }),
    checkEndpoint: vi.fn().mockReturnValue({
      isEndpoint: false,
      reason: 'silence',
      confidence: 0.0,
      silenceDurationMs: 0,
      totalSpeechDurationMs: 0,
    }),
    reset: vi.fn(),
  };
}

function createMockRecordingManager() {
  return {
    startRecording: vi.fn(),
    recordAudioChunk: vi.fn(),
    recordTurn: vi.fn(),
    stopRecording: vi.fn().mockResolvedValue({ sessionId: 'session-1', turns: [] }),
    isEnabled: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
  };
}

function createMockCostTracker() {
  return {
    startSession: vi.fn(),
    endSession: vi.fn(),
    setTurnProvider: vi.fn(),
    trackTTSUsage: vi.fn(),
    trackSTTUsage: vi.fn(),
    trackMCPUsage: vi.fn(),
    getTurnCost: vi.fn().mockReturnValue({
      sttCost: 0.001,
      ttsCost: 0.002,
      mcpCost: 0.003,
      totalCost: 0.006,
      currency: 'USD',
    }),
    getAverageCostPerMinute: vi.fn().mockReturnValue(0.036),
  };
}

function createDependencies(): PipelineDependencies {
  return {
    sessionManager: createMockSessionManager() as unknown as PipelineDependencies['sessionManager'],
    latencyEnforcer:
      createMockLatencyEnforcer() as unknown as PipelineDependencies['latencyEnforcer'],
    sttProvider: createMockSTTProvider() as unknown as PipelineDependencies['sttProvider'],
    ttsProvider: createMockTTSProvider() as unknown as PipelineDependencies['ttsProvider'],
    mcpClient: createMockMCPClient() as unknown as PipelineDependencies['mcpClient'],
    config: createMockConfig() as unknown as PipelineDependencies['config'],
  };
}

describe('Pipeline', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  describe('constructor', () => {
    it('should create pipeline with dependencies', () => {
      expect(pipeline).toBeInstanceOf(Pipeline);
    });

    it('should set up provider listeners', () => {
      // The constructor should have called onUtterance and onEndOfSpeech
      expect(dependencies.sttProvider.onUtterance).toHaveBeenCalled();
      expect(dependencies.sttProvider.onEndOfSpeech).toHaveBeenCalled();
    });
  });

  describe('startSession', () => {
    it('should emit pipeline:start event', async () => {
      const startHandler = vi.fn();
      pipeline.on('pipeline:start', startHandler);

      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      expect(startHandler).toHaveBeenCalled();
    });

    it('should connect STT provider and MCP client', async () => {
      await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

      expect(dependencies.sttProvider.connect).toHaveBeenCalled();
      expect(dependencies.mcpClient.connect).toHaveBeenCalled();
    });
  });

  describe('processAudioChunk', () => {
    it('should stream audio to STT provider', async () => {
      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      await pipeline.processAudioChunk('session-1', chunk);

      expect(dependencies.sttProvider.streamAudio).toHaveBeenCalledWith(chunk);
    });

    it('should emit error for non-existent session', async () => {
      (dependencies.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );
      const errorHandler = vi.fn();
      pipeline.on('pipeline:error', errorHandler);

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x7f]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      await pipeline.processAudioChunk('non-existent', chunk);

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    it('should emit pipeline:end event', async () => {
      const endHandler = vi.fn();
      pipeline.on('pipeline:end', endHandler);

      await pipeline.endSession('session-1');

      expect(endHandler).toHaveBeenCalled();
    });

    it('should close STT provider and MCP client', async () => {
      await pipeline.endSession('session-1');

      expect(dependencies.sttProvider.close).toHaveBeenCalled();
      expect(dependencies.mcpClient.close).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      pipeline.destroy();

      expect(pipeline.listenerCount('pipeline:start')).toBe(0);
    });
  });
});

describe('createPipeline', () => {
  it('should create a pipeline instance', () => {
    const deps = createDependencies();
    const pipeline = createPipeline(deps);

    expect(pipeline).toBeInstanceOf(Pipeline);
    pipeline.destroy();
  });
});

describe('Pipeline - Turn Processing', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should track active turns', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    // Process an audio chunk to create a turn
    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    await pipeline.processAudioChunk('session-1', chunk);

    // Check that turn was created
    expect(dependencies.sessionManager.getSession).toHaveBeenCalled();
  });

  it('should emit pipeline events during session lifecycle', async () => {
    const events: string[] = [];

    pipeline.on('pipeline:start', () => events.push('start'));
    pipeline.on('pipeline:end', () => events.push('end'));

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });
    await pipeline.endSession('session-1');

    expect(events).toContain('start');
    expect(events).toContain('end');
  });

  it('should handle connection errors during startSession', async () => {
    (dependencies.sttProvider.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection failed'),
    );

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    await expect(
      pipeline.startSession({ sessionId: 'session-1', status: 'active' }),
    ).rejects.toThrow('Connection failed');
  });
});

describe('Pipeline - Session Lifecycle', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should handle multiple sessions', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });
    await pipeline.startSession({ sessionId: 'session-2', status: 'active' });

    expect(dependencies.sttProvider.connect).toHaveBeenCalled();
  });

  it('should handle session timeout', async () => {
    const timeoutHandler = vi.fn();
    pipeline.on('pipeline:timeout', timeoutHandler);

    // Simulate session timeout
    (dependencies.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: 'session-1',
      status: 'active',
      callSid: 'CA123',
      mcpEndpoint: 'https://mcp.example.com',
      sttProvider: 'deepgram',
      ttsProvider: 'deepgram',
      turns: [],
      createdAt: new Date(Date.now() - 4000 * 1000), // 4000 seconds ago
      lastActivityAt: new Date(Date.now() - 4000 * 1000),
      ttl: 3600,
      metadata: {},
    });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    await pipeline.processAudioChunk('session-1', chunk);

    // Session should still be valid (not timed out yet)
    expect(dependencies.sttProvider.streamAudio).toHaveBeenCalled();
  });

  it('should emit events for all pipeline stages', async () => {
    const events: string[] = [];

    pipeline.on('pipeline:start', () => events.push('start'));
    pipeline.on('pipeline:stt:start', () => events.push('stt:start'));
    pipeline.on('pipeline:stt:end', () => events.push('stt:end'));
    pipeline.on('pipeline:mcp:start', () => events.push('mcp:start'));
    pipeline.on('pipeline:mcp:end', () => events.push('mcp:end'));
    pipeline.on('pipeline:tts:start', () => events.push('tts:start'));
    pipeline.on('pipeline:tts:end', () => events.push('tts:end'));
    pipeline.on('pipeline:end', () => events.push('end'));

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });
    await pipeline.endSession('session-1');

    expect(events).toContain('start');
    expect(events).toContain('end');
  });
});

describe('Pipeline - Error Handling', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should clean up activeTurn on MCP error', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    (dependencies.mcpClient.sendRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('MCP error'),
    );

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    await pipeline.processAudioChunk('session-1', chunk);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errorHandler).toHaveBeenCalled();
  });

  it('should emit pipeline:error on MCP failure', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    (dependencies.mcpClient.sendRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network timeout'),
    );

    const errors: any[] = [];
    pipeline.on('pipeline:error', (err: any) => errors.push(err));

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    await pipeline.processAudioChunk('session-1', chunk);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].data?.stage).toBe('mcp');
  });
});

describe('Pipeline - Full Event Emission', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit all STT events in order', async () => {
    const deps = createDependencies();
    deps.sttProvider = createMockSTTProviderWithInterim() as unknown as PipelineDependencies['sttProvider'];
    const p = new Pipeline(deps);

    const events: string[] = [];
    p.on('pipeline:stt:start', () => events.push('stt:start'));
    p.on('pipeline:stt:interim', () => events.push('stt:interim'));
    p.on('pipeline:stt:final', () => events.push('stt:final'));
    p.on('pipeline:mcp:request', () => events.push('mcp:request'));
    p.on('pipeline:mcp:response', () => events.push('mcp:response'));
    p.on('pipeline:tts:start', () => events.push('tts:start'));
    p.on('pipeline:tts:first_byte', () => events.push('tts:first_byte'));
    p.on('pipeline:tts:chunk', () => events.push('tts:chunk'));
    p.on('pipeline:tts:complete', () => events.push('tts:complete'));
    p.on('pipeline:turn:end', () => events.push('turn:end'));

    await p.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await p.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events).toContain('stt:start');
    expect(events).toContain('stt:interim');
    expect(events).toContain('stt:final');
    expect(events).toContain('mcp:request');
    expect(events).toContain('mcp:response');
    expect(events).toContain('tts:start');
    expect(events).toContain('tts:first_byte');
    expect(events).toContain('tts:chunk');
    expect(events).toContain('tts:complete');
    expect(events).toContain('turn:end');

    p.destroy();
  });

  it('should emit stt:interim before stt:final', async () => {
    const deps = createDependencies();
    deps.sttProvider = createMockSTTProviderWithInterim() as unknown as PipelineDependencies['sttProvider'];
    const p = new Pipeline(deps);

    const eventOrder: string[] = [];
    p.on('pipeline:stt:interim', () => eventOrder.push('interim'));
    p.on('pipeline:stt:final', () => eventOrder.push('final'));

    await p.startSession({ sessionId: 'session-1', status: 'active' });
    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await p.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const interimIdx = eventOrder.indexOf('interim');
    const finalIdx = eventOrder.indexOf('final');
    expect(interimIdx).toBeLessThan(finalIdx);

    p.destroy();
  });

  it('should emit mcp:request before mcp:response', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const eventOrder: string[] = [];
    pipeline.on('pipeline:mcp:request', () => eventOrder.push('request'));
    pipeline.on('pipeline:mcp:response', () => eventOrder.push('response'));

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(eventOrder.indexOf('request')).toBeLessThan(eventOrder.indexOf('response'));
  });
});

describe('Pipeline - Barge In', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    dependencies.ttsProvider = createSlowTTSProvider() as unknown as PipelineDependencies['ttsProvider'];
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit barge_in event during active TTS', async () => {
    const bargeHandler = vi.fn();
    pipeline.on('pipeline:barge_in', bargeHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 30));

    pipeline.bargeIn('session-1');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(bargeHandler).toHaveBeenCalled();
  });

  it('should call cancel on TTS provider during barge-in', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 30));

    pipeline.bargeIn('session-1');

    expect(dependencies.ttsProvider.cancel).toHaveBeenCalled();
  });

  it('should not barge-in for a different session', async () => {
    const bargeHandler = vi.fn();
    pipeline.on('pipeline:barge_in', bargeHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    pipeline.bargeIn('session-other');

    expect(bargeHandler).not.toHaveBeenCalled();
  });

  it('should not emit barge_in when no active TTS turn', () => {
    const bargeHandler = vi.fn();
    pipeline.on('pipeline:barge_in', bargeHandler);

    pipeline.bargeIn('session-1');

    expect(bargeHandler).not.toHaveBeenCalled();
  });
});

describe('Pipeline - DTMF Processing', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit dtmf:received on digit input', () => {
    const receivedHandler = vi.fn();
    pipeline.on('pipeline:dtmf:received', receivedHandler);

    pipeline.processDTMFInput('session-1', '1');

    expect(receivedHandler).toHaveBeenCalled();
    const event = receivedHandler.mock.calls[0][0];
    expect(event.data.digit).toBe('1');
    expect(event.data.sequence).toBe('1');
  });

  it('should emit dtmf:complete when terminator digit is pressed', () => {
    const completeHandler = vi.fn();
    pipeline.on('pipeline:dtmf:complete', completeHandler);

    pipeline.processDTMFInput('session-1', '1');
    pipeline.processDTMFInput('session-1', '2');
    pipeline.processDTMFInput('session-1', '3');
    pipeline.processDTMFInput('session-1', '#');

    expect(completeHandler).toHaveBeenCalled();
    const event = completeHandler.mock.calls[0][0];
    expect(event.data.sequence).toBe('123');
  });

  it('should emit dtmf:complete when max digits reached', () => {
    const completeHandler = vi.fn();
    pipeline.on('pipeline:dtmf:complete', completeHandler);

    for (let i = 0; i < 12; i++) {
      pipeline.processDTMFInput('session-1', String(i % 10));
    }

    expect(completeHandler).toHaveBeenCalled();
  });

  it('should reset DTMF sequence on inter-digit timeout', () => {
    vi.useFakeTimers();
    const completeHandler = vi.fn();
    pipeline.on('pipeline:dtmf:complete', completeHandler);
    const receivedHandler = vi.fn();
    pipeline.on('pipeline:dtmf:received', receivedHandler);

    pipeline.processDTMFInput('session-1', '1');
    pipeline.processDTMFInput('session-1', '2');

    vi.advanceTimersByTime(3000);

    pipeline.processDTMFInput('session-1', '3');

    const calls = receivedHandler.mock.calls.map(
      (c: any) => c[0].data.sequence,
    );
    // After timeout, the sequence should reset: 3 is alone, not 123
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBe('3');

    vi.useRealTimers();
  });

  it('should not process DTMF when disabled', () => {
    const deps = createDependencies();
    (deps.config as any).dtmf = { enabled: false, interDigitTimeout: 2000, maxDigits: 10 };
    const p = new Pipeline(deps);

    const receivedHandler = vi.fn();
    p.on('pipeline:dtmf:received', receivedHandler);

    p.processDTMFInput('session-1', '1');

    expect(receivedHandler).not.toHaveBeenCalled();
    p.destroy();
  });

  it('should send DTMF sequence to MCP on complete', async () => {
    const mcpSendSpy = dependencies.mcpClient.sendRequest as ReturnType<typeof vi.fn>;

    pipeline.processDTMFInput('session-1', '1');
    pipeline.processDTMFInput('session-1', '2');
    pipeline.processDTMFInput('session-1', '#');

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mcpSendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        utterance: '[DTMF:12]',
      }),
    );
  });
});

describe('Pipeline - VAD Integration', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    vi.useFakeTimers();
    dependencies = createDependencies();
    dependencies.vadProvider = createMockVADProvider() as unknown as PipelineDependencies['vadProvider'];
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
    vi.useRealTimers();
  });

  it('should feed audio chunks to VAD provider', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);

    expect(dependencies.vadProvider.process).toHaveBeenCalledWith(chunk);
  });

  it('should emit vad:endpoint when VAD detects endpoint', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const endpointHandler = vi.fn();
    pipeline.on('pipeline:vad:endpoint', endpointHandler);

    (dependencies.vadProvider.checkEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      isEndpoint: true,
      reason: 'silence',
      confidence: 0.9,
      silenceDurationMs: 600,
      totalSpeechDurationMs: 2000,
    });

    vi.advanceTimersByTime(200);

    expect(endpointHandler).toHaveBeenCalled();
    const event = endpointHandler.mock.calls[0][0];
    expect(event.data.reason).toBe('silence');
  });

  it('should handle VAD without crashing when not configured', () => {
    const deps = createDependencies();
    const p = new Pipeline(deps);

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    expect(() => p.processAudioChunk('session-1', chunk)).not.toThrow();
    p.destroy();
  });
});

describe('Pipeline - Thinking Audio', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    dependencies.thinkingAudioManager = new ThinkingAudioManager(
      { enabled: true, strategy: 'filler', fillerToneHz: 440, fillerVolume: 0.1, maxDurationMs: 800 },
      vi.fn(),
    );
    dependencies.config = {
      ...createMockConfig(),
      thinkingAudio: { enabled: true, strategy: 'filler' },
    } as unknown as PipelineDependencies['config'];
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit thinking:start and thinking:stop during MCP processing', async () => {
    const thinkingStartHandler = vi.fn();
    const thinkingStopHandler = vi.fn();
    pipeline.on('pipeline:thinking:start', thinkingStartHandler);
    pipeline.on('pipeline:thinking:stop', thinkingStopHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(thinkingStartHandler).toHaveBeenCalled();
    expect(thinkingStopHandler).toHaveBeenCalled();
  });

  it('should emit error and stop thinking when MCP fails with thinking audio', async () => {
    (dependencies.mcpClient.sendRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('MCP error with thinking'),
    );

    const thinkingStopHandler = vi.fn();
    pipeline.on('pipeline:thinking:stop', thinkingStopHandler);
    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(thinkingStopHandler).toHaveBeenCalled();
    expect(errorHandler).toHaveBeenCalled();
  });

  it('should not start thinking when thinkingAudio is disabled', async () => {
    const deps = createDependencies();
    deps.thinkingAudioManager = new ThinkingAudioManager(
      { enabled: false, strategy: 'none' },
      vi.fn(),
    );
    deps.config = {
      ...createMockConfig(),
    } as unknown as PipelineDependencies['config'];
    const p = new Pipeline(deps);

    const thinkingStartHandler = vi.fn();
    p.on('pipeline:thinking:start', thinkingStartHandler);

    await p.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await p.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(thinkingStartHandler).not.toHaveBeenCalled();
    p.destroy();
  });
});

describe('Pipeline - TTS Error Handling', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    dependencies.ttsProvider = createFailingTTSProvider('TTS synthesis failed') as unknown as PipelineDependencies['ttsProvider'];
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit pipeline:error when TTS fails', async () => {
    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errorHandler).toHaveBeenCalled();
  });

  it('should set error stage to tts on TTS failure', async () => {
    const errors: any[] = [];
    pipeline.on('pipeline:error', (err: any) => errors.push(err));

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ttsError = errors.find((e: any) => e.data?.stage === 'tts');
    expect(ttsError).toBeDefined();
  });
});

describe('Pipeline - Edge Cases', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should handle empty audio chunks', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const emptyChunk: AudioChunk = {
      buffer: Buffer.alloc(0),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };

    expect(() => pipeline.processAudioChunk('session-1', emptyChunk)).not.toThrow();
    expect(dependencies.sttProvider.streamAudio).toHaveBeenCalledWith(emptyChunk);
  });

  it('should emit error when session not found', async () => {
    (dependencies.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);

    expect(errorHandler).toHaveBeenCalled();
  });

  it('should emit error for inactive session', async () => {
    (dependencies.sessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: 'session-1',
      status: 'closed',
    });

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);

    expect(errorHandler).toHaveBeenCalled();
  });

  it('should handle endSession after error gracefully', async () => {
    const endHandler = vi.fn();
    pipeline.on('pipeline:end', endHandler);

    await pipeline.endSession('session-1');

    expect(endHandler).toHaveBeenCalled();
  });

  it('should clean up session-specific turns on endSession', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await pipeline.endSession('session-1');

    expect(dependencies.sttProvider.close).toHaveBeenCalled();
    expect(dependencies.mcpClient.close).toHaveBeenCalled();
  });

  it('should handle multiple utterances in sequence', async () => {
    const deps = createDependencies();
    deps.sttProvider = createMockSTTProviderWithInterim() as unknown as PipelineDependencies['sttProvider'];
    const p = new Pipeline(deps);

    const sttFinalHandler = vi.fn();
    p.on('pipeline:stt:final', sttFinalHandler);

    await p.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await p.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sttFinalHandler).toHaveBeenCalledTimes(1);

    p.destroy();
  });
});

describe('Pipeline - Cost Integration', () => {
  let pipeline: Pipeline;

  beforeEach(() => {
    const deps = createDependencies();
    deps.recordingManager = createMockRecordingManager() as unknown as PipelineDependencies['recordingManager'];
    deps.costTracker = createMockCostTracker() as unknown as PipelineDependencies['costTracker'];
    (deps.config as any).cost = { enabled: true };
    pipeline = new Pipeline(deps);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should call cost tracker on start and end session', async () => {
    const costTracker = (pipeline as any).dependencies.costTracker;

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });
    expect(costTracker.startSession).toHaveBeenCalledWith('session-1');

    await pipeline.endSession('session-1');
    expect(costTracker.endSession).toHaveBeenCalledWith('session-1');
  });
});

describe('createPipelineForMode', () => {
  it('should create a staged Pipeline for default mode', () => {
    const deps = createDependencies();
    const pipeline = createPipelineForMode(deps);
    expect(pipeline).toBeInstanceOf(Pipeline);
    pipeline.destroy();
  });

  it('should throw when S2S mode selected without deps', () => {
    const deps = createDependencies();
    (deps.config as any).mode = 'speech-to-speech';
    expect(() => createPipelineForMode(deps)).toThrow('S2S pipeline dependencies');
  });

  it('should clean up with destroy', () => {
    const deps = createDependencies();
    const p = new Pipeline(deps);
    expect(() => p.destroy()).not.toThrow();
  });
});

describe('Pipeline - EndOfSpeech Handling', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    dependencies.sttProvider = createMockSTTProviderWithEndOfSpeech() as unknown as PipelineDependencies['sttProvider'];
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should emit stt:eos on end of speech event', async () => {
    const eosHandler = vi.fn();
    pipeline.on('pipeline:stt:eos', eosHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const stt = dependencies.sttProvider as unknown as ReturnType<typeof createMockSTTProviderWithEndOfSpeech>;
    stt.triggerEndOfSpeech();

    expect(eosHandler).toHaveBeenCalled();
  });

  it('should force finalize pending utterances on end of speech', async () => {
    const finalHandler = vi.fn();
    pipeline.on('pipeline:stt:final', finalHandler);

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const stt = dependencies.sttProvider as unknown as ReturnType<typeof createMockSTTProviderWithEndOfSpeech>;

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 20));

    stt.triggerEndOfSpeech();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(finalHandler).toHaveBeenCalled();
  });
});

describe('Pipeline - Conversation History', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    (dependencies.sessionManager.getConversationHistory as ReturnType<typeof vi.fn>).mockReturnValue([
      { userUtterance: 'Hello', agentResponse: 'Hi there!', turnId: 'turn-0', timestamp: new Date(), latencyMs: 100 },
    ]);
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should include conversation history in MCP request', async () => {
    const mcpSpy = dependencies.mcpClient.sendRequest as ReturnType<typeof vi.fn>;

    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mcpSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello' }),
          expect.objectContaining({ role: 'assistant', content: 'Hi there!' }),
        ]),
      }),
    );
  });
});

describe('Pipeline - Recording and Cost Full Flow', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    dependencies.recordingManager = createMockRecordingManager() as unknown as PipelineDependencies['recordingManager'];
    (dependencies.recordingManager.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    dependencies.costTracker = createMockCostTracker() as unknown as PipelineDependencies['costTracker'];
    (dependencies.config as any).cost = { enabled: true };
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should track cost per turn during full flow', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const costTracker = dependencies.costTracker as ReturnType<typeof createMockCostTracker>;
    expect(costTracker.setTurnProvider).toHaveBeenCalled();
    expect(costTracker.trackTTSUsage).toHaveBeenCalled();
    expect(costTracker.trackSTTUsage).toHaveBeenCalled();
    expect(costTracker.trackMCPUsage).toHaveBeenCalled();
    expect(costTracker.getTurnCost).toHaveBeenCalled();
    expect(costTracker.getAverageCostPerMinute).toHaveBeenCalled();
  });

  it('should record turn via recording manager', async () => {
    await pipeline.startSession({ sessionId: 'session-1', status: 'active' });

    const chunk: AudioChunk = {
      buffer: Buffer.from([0x7f]),
      sampleRate: 8000,
      encoding: 'mulaw',
      channels: 1,
      timestamp: Date.now(),
    };
    await pipeline.processAudioChunk('session-1', chunk);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(dependencies.recordingManager.recordTurn).toHaveBeenCalled();
  });
});

describe('Pipeline - endSession Error Handling', () => {
  let pipeline: Pipeline;
  let dependencies: PipelineDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
    pipeline = new Pipeline(dependencies);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('should handle STT close error during endSession', async () => {
    (dependencies.sttProvider.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Close error'));

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    await pipeline.endSession('session-1');

    expect(errorHandler).toHaveBeenCalled();
  });
});
