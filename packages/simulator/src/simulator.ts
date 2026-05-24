import {
  type AudioChunk,
  createLatencyBudget,
  createMockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
  createPipeline,
  getDefaultConfig,
  initializeSessionManager,
  type LatencyBudget,
  LatencyBudgetEnforcer,
  type Pipeline,
  SessionManager,
  type VoiceAgentKitConfig,
} from '@reaatech/voice-agent-core';
import { createMCPClient } from '@reaatech/voice-agent-mcp-client';
import { createSTTProvider } from '@reaatech/voice-agent-stt';
import { createTTSProvider } from '@reaatech/voice-agent-tts';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { captureMicrophone, playAudio, readWavFile, writeWavFile } from './audio-io.js';
import { type LatencyWaterfallRow, renderLatencyWaterfall } from './latency-waterfall.js';

export interface SimulatorTurnMetrics {
  turnId: string;
  turnNumber: number;
  userSaid: string;
  agentSaid: string;
  sttMs: number;
  mcpMs: number;
  ttsFirstByteMs: number;
  totalMs: number;
  budgetExceeded: boolean;
  exceededStages: string[];
}

export type SimulatorEvent =
  | 'turn:start'
  | 'turn:interim'
  | 'turn:final'
  | 'turn:tts'
  | 'turn:complete'
  | 'session:end'
  | 'error';

export interface SimulatorOptions {
  sttProvider: string;
  ttsProvider: string;
  mcpEndpoint: string;
  sttApiKey?: string;
  ttsApiKey?: string;
  mcpApiKey?: string;
  mcpTimeout?: number;
  outputPath?: string;
  configPath?: string;
  verbose?: boolean;
  speedMultiplier?: number;
  saveSession?: string;
  chunkDurationMs?: number;
  ttsVoice?: string;
  ttsSpeed?: number;
}

export interface SimulatorResult {
  sessionId: string;
  turns: SimulatorTurnMetrics[];
  totalAudioChunks: number;
  waterfallTable: string;
  sessionTranscript: Array<{ userSaid: string; agentSaid: string }>;
}

export class Simulator extends EventEmitter {
  private sessionManager?: SessionManager;
  private currentSessionId?: string;
  private turnCount = 0;
  private turnMetrics: SimulatorTurnMetrics[] = [];
  private sessionTranscript: Array<{ userSaid: string; agentSaid: string }> = [];
  private ttsAudioChunks: AudioChunk[] = [];
  private budget: LatencyBudget;
  private pipelineInstance: Pipeline | null = null;
  private verbose: boolean;
  private options: SimulatorOptions;

  constructor(options: SimulatorOptions) {
    super();
    this.options = options;
    this.verbose = options.verbose ?? false;
    this.budget = createLatencyBudget({});
  }

  async runFile(inputPath: string): Promise<SimulatorResult> {
    const audioStream = readWavFile(inputPath, {
      chunkDurationMs: this.options.chunkDurationMs,
      speedMultiplier: this.options.speedMultiplier,
    });

    return this.runStream(audioStream);
  }

  async runMic(): Promise<SimulatorResult> {
    const audioStream = captureMicrophone({
      sampleRate: 8000,
      chunkDurationMs: this.options.chunkDurationMs,
    });

    return this.runStream(audioStream);
  }

  async runStream(audioStream: AsyncIterable<AudioChunk>): Promise<SimulatorResult> {
    await this.initialize();

    const sessionId = this.currentSessionId;
    if (!sessionId) {
      throw new Error('Simulator initialization failed: no session ID');
    }

    try {
      this.emit('session:start', { sessionId });

      for await (const chunk of audioStream) {
        await this.pipelineInstance?.processAudioChunk(sessionId, chunk);
      }

      await this.pipelineInstance?.endSession(sessionId);
      this.emit('session:end', { sessionId, turns: this.turnMetrics });

      // Optionally write TTS output
      if (this.options.outputPath && this.ttsAudioChunks.length > 0) {
        await writeWavFile(this.options.outputPath, this.ttsAudioChunks);
      }

      // Optionally play audio
      if (!this.options.outputPath && this.ttsAudioChunks.length > 0) {
        try {
          await playAudio(this.ttsAudioChunks);
        } catch {
          // Playback is best-effort
        }
      }

      // Optionally save session data
      if (this.options.saveSession) {
        await this.saveSessionData(this.options.saveSession);
      }

      const rows: LatencyWaterfallRow[] = this.turnMetrics.map((m) => ({
        turn: m.turnNumber,
        userSaid: m.userSaid,
        agentSaid: m.agentSaid,
        sttMs: m.sttMs,
        mcpMs: m.mcpMs,
        ttsFirstByteMs: m.ttsFirstByteMs,
        totalMs: m.totalMs,
        sttBudget: this.budget.stages.stt,
        mcpBudget: this.budget.stages.mcp,
        ttsBudget: this.budget.stages.tts,
        totalBudgetTarget: this.budget.total.target,
        totalBudgetHardCap: this.budget.total.hardCap,
      }));

      const waterfallTable = renderLatencyWaterfall(rows);

      if (this.verbose) {
        process.stdout.write(`\n${waterfallTable}\n\n`);
      }

      return {
        sessionId,
        turns: this.turnMetrics,
        totalAudioChunks: this.ttsAudioChunks.length,
        waterfallTable,
        sessionTranscript: this.sessionTranscript,
      };
    } finally {
      await this.cleanup();
    }
  }

  private async initialize(): Promise<void> {
    const config = this.buildConfig();

    const sessionManager = new SessionManager({
      defaultTTL: config.session.ttl,
      maxTurns: config.session.history.maxTurns,
      maxTokens: config.session.history.maxTokens,
      cleanupInterval: 60000,
    });

    initializeSessionManager({
      defaultTTL: config.session.ttl,
      maxTurns: config.session.history.maxTurns,
      maxTokens: config.session.history.maxTokens,
    });

    this.sessionManager = sessionManager;
    this.budget = createLatencyBudget({
      target: config.latency.total.target,
      hardCap: config.latency.total.hardCap,
      stt: config.latency.stages.stt,
      mcp: config.latency.stages.mcp,
      tts: config.latency.stages.tts,
    });

    const latencyEnforcer = new LatencyBudgetEnforcer(this.budget);

    const sttProvider = this.createSTTProvider();
    const ttsProvider = this.createTTSProvider();
    const mcpClient = this.createMCPClient(config);

    const pipeline = createPipeline({
      sessionManager,
      latencyEnforcer,
      sttProvider,
      ttsProvider,
      mcpClient,
      config,
    });

    this.pipelineInstance = pipeline;
    this.setupPipelineListeners(pipeline);

    const session = sessionManager.createSession({
      callSid: `sim-${uuidv4().slice(0, 8)}`,
      mcpEndpoint: this.options.mcpEndpoint,
      sttProvider: this.options.sttProvider,
      ttsProvider: this.options.ttsProvider,
      metadata: {
        simulator: true,
        inputType: 'simulator',
      },
    });

    this.currentSessionId = session.sessionId;

    await pipeline.startSession({
      sessionId: session.sessionId,
      status: 'active',
    });
  }

  private createSTTProvider() {
    const providerName = this.options.sttProvider;

    if (providerName === 'mock') {
      return createMockSTTProvider({
        delay: 80,
        confidence: 0.95,
        interimCount: 2,
      });
    }

    const validProviders = ['deepgram', 'aws-transcribe', 'google-cloud-stt'] as const;
    if (validProviders.includes(providerName as (typeof validProviders)[number])) {
      return createSTTProvider({
        provider: providerName as (typeof validProviders)[number],
        config: {
          provider: providerName,
          apiKey: this.options.sttApiKey ?? process.env.STT_API_KEY,
          sampleRate: 8000,
        },
      } as Parameters<typeof createSTTProvider>[0]) as unknown as ReturnType<
        typeof createMockSTTProvider
      >;
    }

    throw new Error(
      `Unknown STT provider: ${providerName}. Valid options: mock, deepgram, aws-transcribe, google-cloud-stt`,
    );
  }

  private createTTSProvider() {
    const providerName = this.options.ttsProvider;

    if (providerName === 'mock') {
      return createMockTTSProvider({
        delay: 50,
        firstByteDelay: 100,
        chunkSize: 320,
        sampleRate: 8000,
        encoding: 'mulaw',
      });
    }

    const validProviders = ['deepgram', 'aws-polly', 'google-cloud-tts'] as const;
    if (validProviders.includes(providerName as (typeof validProviders)[number])) {
      return createTTSProvider({
        provider: providerName as (typeof validProviders)[number],
        config: {
          provider: providerName,
          apiKey: this.options.ttsApiKey ?? process.env.TTS_API_KEY,
          voice: this.options.ttsVoice,
          speed: this.options.ttsSpeed ?? 1.0,
        },
      } as Parameters<typeof createTTSProvider>[0]) as unknown as ReturnType<
        typeof createMockTTSProvider
      >;
    }

    throw new Error(
      `Unknown TTS provider: ${providerName}. Valid options: mock, deepgram, aws-polly, google-cloud-tts`,
    );
  }

  private createMCPClient(config: VoiceAgentKitConfig) {
    if (this.options.mcpEndpoint === 'mock') {
      return createMockMCPClient({
        delay: 200,
        responsePrefix: 'I understand you said:',
        responseSuffix: 'How can I help you further?',
      });
    }

    const realClient = createMCPClient({
      endpoint: this.options.mcpEndpoint,
      auth: this.options.mcpApiKey
        ? {
            type: 'bearer' as const,
            credentials: { token: this.options.mcpApiKey },
          }
        : undefined,
      timeout: this.options.mcpTimeout ?? config.mcp.timeout,
    });

    return {
      connect: () => realClient.connect(),
      close: () => realClient.close(),
      sendRequest: async (params: {
        sessionId: string;
        turnId: string;
        utterance: string;
        history: Array<{ role: string; content: string }>;
      }) => {
        const response = await realClient.sendRequest(params);
        return {
          text: response.text,
          toolCalls: (response.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            arguments: tc.arguments,
          })),
          latencyMs: response.latencyMs,
          confidence: response.confidence,
        };
      },
    };
  }

  private buildConfig(): VoiceAgentKitConfig {
    const defaults = getDefaultConfig();

    return {
      mcp: {
        endpoint: this.options.mcpEndpoint,
        auth: this.options.mcpApiKey
          ? {
              type: 'bearer',
              credentials: { token: this.options.mcpApiKey },
            }
          : undefined,
        timeout: this.options.mcpTimeout ?? defaults.mcp.timeout,
      },
      stt: {
        provider: this.options.sttProvider,
        apiKey: this.options.sttApiKey ?? process.env.STT_API_KEY,
        sampleRate: 8000,
      },
      tts: {
        provider: this.options.ttsProvider,
        apiKey: this.options.ttsApiKey ?? process.env.TTS_API_KEY,
        voice: this.options.ttsVoice ?? 'asteria',
        speed: this.options.ttsSpeed ?? 1.0,
      },
      latency: defaults.latency,
      session: defaults.session,
      bargeIn: defaults.bargeIn,
    };
  }

  private setupPipelineListeners(pipeline: Pipeline): void {
    let currentTurnId: string | null = null;
    let currentUserSaid = '';
    let currentAgentSaid = '';

    pipeline.on('pipeline:stt:start', (event) => {
      currentTurnId = (event.data?.turnId as string) ?? null;
      currentUserSaid = '';
      currentAgentSaid = '';
      this.emit('turn:start', { turnId: currentTurnId, timestamp: event.timestamp });
    });

    pipeline.on('pipeline:stt:interim', (event) => {
      const transcript = (event.data?.transcript as string) ?? '';
      currentUserSaid = transcript;
      this.emit('turn:interim', { turnId: currentTurnId, transcript, timestamp: event.timestamp });
    });

    pipeline.on('pipeline:stt:final', (event) => {
      const transcript = (event.data?.transcript as string) ?? '';
      currentUserSaid = transcript;
      this.emit('turn:final', { turnId: currentTurnId, transcript, timestamp: event.timestamp });
    });

    pipeline.on('pipeline:tts:start', (event) => {
      const text = (event.data?.text as string) ?? '';
      currentAgentSaid = text;
    });

    pipeline.on('pipeline:tts:chunk', (event) => {
      const chunk = event.data as unknown as AudioChunk | undefined;
      if (chunk?.buffer) {
        this.ttsAudioChunks.push({
          buffer: chunk.buffer as Buffer,
          sampleRate: (chunk.sampleRate as number) ?? 8000,
          encoding: (chunk.encoding as AudioChunk['encoding']) ?? 'mulaw',
          channels: (chunk.channels as number) ?? 1,
          timestamp: (chunk.timestamp as number) ?? Date.now(),
        });
      }
      this.emit('turn:tts', {
        turnId: currentTurnId,
        chunkSize: event.data?.chunkSize,
        timestamp: event.timestamp,
      });
    });

    pipeline.on('pipeline:turn:end', (event) => {
      const metrics = event.data?.metrics as Record<string, unknown> | undefined;
      const turnId = (event.data?.turnId as string) ?? currentTurnId ?? 'unknown';

      this.turnCount++;

      const turnMetrics: SimulatorTurnMetrics = {
        turnId,
        turnNumber: this.turnCount,
        userSaid: currentUserSaid,
        agentSaid: currentAgentSaid,
        sttMs: Math.round((metrics?.sttLatencyMs as number) ?? 0),
        mcpMs: Math.round((metrics?.mcpLatencyMs as number) ?? 0),
        ttsFirstByteMs: Math.round((metrics?.ttsFirstByteMs as number) ?? 0),
        totalMs: Math.round((metrics?.totalTurnLatencyMs as number) ?? 0),
        budgetExceeded: (metrics?.budgetExceeded as boolean) ?? false,
        exceededStages: (metrics?.exceededStages as string[]) ?? [],
      };

      this.turnMetrics.push(turnMetrics);
      this.sessionTranscript.push({
        userSaid: currentUserSaid,
        agentSaid: currentAgentSaid,
      });

      this.emit('turn:complete', turnMetrics);

      currentTurnId = null;
    });

    pipeline.on('pipeline:error', (event) => {
      const error = event.data?.error as string | undefined;
      this.emit('error', {
        sessionId: event.sessionId,
        turnId: event.data?.turnId,
        error: error ?? 'Unknown pipeline error',
        stage: event.data?.stage,
      });
    });
  }

  private async saveSessionData(filePath: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');

    const data = {
      sessionId: this.currentSessionId,
      timestamp: new Date().toISOString(),
      turns: this.turnMetrics,
      transcript: this.sessionTranscript,
      options: {
        sttProvider: this.options.sttProvider,
        ttsProvider: this.options.ttsProvider,
        mcpEndpoint: this.options.mcpEndpoint,
      },
      waterfallTable: renderLatencyWaterfall(
        this.turnMetrics.map((m) => ({
          turn: m.turnNumber,
          userSaid: m.userSaid,
          agentSaid: m.agentSaid,
          sttMs: m.sttMs,
          mcpMs: m.mcpMs,
          ttsFirstByteMs: m.ttsFirstByteMs,
          totalMs: m.totalMs,
          sttBudget: this.budget.stages.stt,
          mcpBudget: this.budget.stages.mcp,
          ttsBudget: this.budget.stages.tts,
          totalBudgetTarget: this.budget.total.target,
          totalBudgetHardCap: this.budget.total.hardCap,
        })),
      ),
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async cleanup(): Promise<void> {
    if (this.pipelineInstance) {
      try {
        this.pipelineInstance.destroy();
      } catch {
        // Best-effort
      }
      this.pipelineInstance = null;
    }

    if (this.sessionManager) {
      try {
        this.sessionManager.destroy();
      } catch {
        // Best-effort
      }
      this.sessionManager = undefined;
    }

    this.currentSessionId = undefined;
  }
}

export function createSimulator(options: SimulatorOptions): Simulator {
  return new Simulator(options);
}
