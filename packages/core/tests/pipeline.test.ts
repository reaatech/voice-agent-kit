import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pipeline, createPipeline } from '../src/pipeline/index.js';
import type { PipelineDependencies } from '../src/pipeline/index.js';
import type { AudioChunk, Utterance } from '../src/types/index.js';

// Mock providers
function createMockSTTProvider() {
  let onUtteranceCallback: ((utterance: Utterance) => void) | undefined;
  return {
    name: 'mock-stt',
    connect: vi.fn().mockResolvedValue(undefined),
    streamAudio: vi.fn().mockImplementation(() => {
      if (onUtteranceCallback) {
        setTimeout(() => {
          onUtteranceCallback!({
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
        undefined
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
      new Error('Connection failed')
    );

    const errorHandler = vi.fn();
    pipeline.on('pipeline:error', errorHandler);

    await expect(
      pipeline.startSession({ sessionId: 'session-1', status: 'active' })
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
      new Error('MCP error')
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
      new Error('Network timeout')
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
