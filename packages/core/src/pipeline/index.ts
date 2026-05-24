import { SpanKind } from '@opentelemetry/api';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { CostTracker } from '../cost/cost-tracker.js';
import type { LatencyBudgetEnforcer } from '../latency/index.js';
import { getObservability } from '../observability/index.js';
import type { RecordingManager } from '../recording/recording-manager.js';
import type { SessionManager } from '../session/index.js';
import type {
  AgentResponse,
  AudioChunk,
  PipelineEvent,
  TurnRecord,
  Utterance,
  VoiceAgentKitConfig,
} from '../types/index.js';
import type { VADProvider } from '../vad/interface.js';
import type { S2SPipelineDependencies, S2SProvider } from './s2s-pipeline.js';
import { createSpeechToSpeechPipeline, SpeechToSpeechPipeline } from './s2s-pipeline.js';
import type { ThinkingAudioManager } from './thinking-audio.js';

export type { S2SPipelineDependencies, S2SProvider };
export { createSpeechToSpeechPipeline, SpeechToSpeechPipeline };

// Provider interfaces
export interface STTProvider {
  readonly name: string;
  connect(config: unknown): Promise<void>;
  streamAudio(chunk: AudioChunk): void;
  onUtterance(cb: (utterance: Utterance) => void): void;
  onEndOfSpeech(cb: () => void): void;
  close(): Promise<void>;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, config: unknown): AsyncIterable<AudioChunk>;
  readonly supportsStreaming: boolean;
  readonly firstByteLatencyMs: number | null;
  connect?(config: unknown): Promise<void>;
  cancel?(): void;
  close?(): Promise<void>;
}

export interface MCPClient {
  connect(): Promise<void>;
  sendRequest(params: {
    sessionId: string;
    turnId: string;
    utterance: string;
    history: Array<{ role: string; content: string }>;
  }): Promise<AgentResponse>;
  close(): Promise<void>;
}

export interface PipelineDependencies {
  sessionManager: SessionManager;
  latencyEnforcer: LatencyBudgetEnforcer;
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  mcpClient: MCPClient;
  config: VoiceAgentKitConfig;
  vadProvider?: VADProvider;
  thinkingAudioManager?: ThinkingAudioManager;
  recordingManager?: RecordingManager;
  costTracker?: CostTracker;
}

export class Pipeline extends EventEmitter {
  private readonly dependencies: PipelineDependencies;
  private readonly activeTurns: Map<
    string,
    {
      sessionId: string;
      turnId: string;
      startTime: number;
      audioChunks: AudioChunk[];
      utterances: Utterance[];
      isProcessing: boolean;
    }
  > = new Map();
  private currentSessionId?: string;
  private activeTTSTurnId?: string;
  private ttsCancelled = false;

  // DTMF state
  private dtmfSequence = '';
  private dtmfSequenceCallSid = '';
  private dtmfDigitTimes: number[] = [];
  private dtmfTimer?: NodeJS.Timeout;
  private dtmfEnabled: boolean;
  private dtmfInterDigitTimeout: number;
  private dtmfMaxDigits: number;
  private dtmfTerminatorDigit: string;

  // VAD endpoint check interval
  private vadCheckInterval?: NodeJS.Timeout;

  constructor(dependencies: PipelineDependencies) {
    super();
    this.dependencies = dependencies;

    const dtmfConfig = dependencies.config.dtmf ?? {
      enabled: true,
      interDigitTimeout: 2000,
      maxDigits: 10,
      terminatorDigit: '#',
    };
    this.dtmfEnabled = dtmfConfig.enabled;
    this.dtmfInterDigitTimeout = dtmfConfig.interDigitTimeout;
    this.dtmfMaxDigits = dtmfConfig.maxDigits;
    this.dtmfTerminatorDigit = dtmfConfig.terminatorDigit ?? '#';

    this.setupProviderListeners();
    this.setupVADCheck();
  }

  private setupProviderListeners(): void {
    // STT listeners
    this.dependencies.sttProvider.onUtterance((utterance: Utterance) => {
      void this.handleUtterance(utterance);
    });

    this.dependencies.sttProvider.onEndOfSpeech(() => {
      void this.handleEndOfSpeech();
    });
  }

  async startSession(session: { sessionId: string; status: string }): Promise<void> {
    this.currentSessionId = session.sessionId;

    const sessionData = this.dependencies.sessionManager.getSession(session.sessionId);
    const callSid = sessionData?.callSid ?? session.sessionId;

    this.dependencies.recordingManager?.startRecording(
      session.sessionId,
      callSid,
      sessionData?.metadata,
    );

    this.dependencies.costTracker?.startSession(session.sessionId);

    this.emit('pipeline:start', this.createEvent('pipeline:start', session.sessionId));

    try {
      await this.dependencies.sttProvider.connect(this.dependencies.config.stt);
      await this.dependencies.ttsProvider.connect?.(this.dependencies.config.tts);
      await this.dependencies.mcpClient.connect();
    } catch (error) {
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', session.sessionId, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  bargeIn(sessionId: string): void {
    if (this.currentSessionId !== sessionId && this.currentSessionId !== undefined) {
      return;
    }
    if (this.activeTTSTurnId) {
      this.ttsCancelled = true;
      try {
        this.dependencies.ttsProvider.cancel?.();
      } catch {
        // best-effort cancellation
      }
      getObservability().recordBargeIn(sessionId);
      this.emit(
        'pipeline:barge_in',
        this.createEvent('pipeline:barge_in', sessionId, {
          turnId: this.activeTTSTurnId,
        }),
      );
    }
  }

  async processAudioChunk(sessionId: string, chunk: AudioChunk): Promise<void> {
    const session = this.dependencies.sessionManager.getSession(sessionId);

    if (!session || session.status !== 'active') {
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, { error: 'Session not found or inactive' }),
      );
      return;
    }

    // Record inbound audio
    this.dependencies.recordingManager?.recordAudioChunk(sessionId, chunk, 'inbound');

    // Feed audio to VAD if configured
    this.dependencies.vadProvider?.process(chunk);

    // Stream audio to STT provider
    this.dependencies.sttProvider.streamAudio(chunk);
  }

  private async handleUtterance(utterance: Utterance): Promise<void> {
    const observability = getObservability();
    const sessionId = this.getActiveSessionId();

    const span = observability.startSpan(
      'voice.stt',
      {
        sessionId,
        provider: this.dependencies.config.stt.provider,
        model:
          typeof this.dependencies.config.stt.model === 'string'
            ? this.dependencies.config.stt.model
            : undefined,
        isFinal: utterance.isFinal,
      },
      SpanKind.CLIENT,
    );

    let createdTurnId: string | undefined;

    try {
      let activeTurnId: string | undefined;
      let activeTurnSessionId: string | undefined;

      for (const [turnId, turn] of this.activeTurns.entries()) {
        if (!turn.isProcessing) {
          activeTurnId = turnId;
          activeTurnSessionId = turn.sessionId;
          break;
        }
      }

      if (!activeTurnId || !activeTurnSessionId) {
        const newSessionId = this.getActiveSessionId();

        if (!newSessionId) {
          this.emit(
            'pipeline:error',
            this.createEvent('pipeline:error', 'unknown', { error: 'No active session' }),
          );
          span?.end();
          return;
        }

        const turnId = uuidv4();
        const session = this.dependencies.sessionManager.getSession(newSessionId);

        if (!session) {
          span?.end();
          return;
        }

        this.dependencies.latencyEnforcer.startTurn(turnId);
        this.dependencies.latencyEnforcer.startStage(turnId, 'stt');

        this.activeTurns.set(turnId, {
          sessionId: newSessionId,
          turnId,
          startTime: performance.now(),
          audioChunks: [],
          utterances: [],
          isProcessing: true,
        });

        activeTurnId = turnId;
        activeTurnSessionId = newSessionId;
        createdTurnId = turnId;

        this.emit(
          'pipeline:stt:start',
          this.createEvent('pipeline:stt:start', newSessionId, { turnId }),
        );
      }

      const turn = this.activeTurns.get(activeTurnId);

      if (!turn) {
        span?.end();
        return;
      }

      turn.utterances.push(utterance);

      if (utterance.isFinal) {
        this.dependencies.latencyEnforcer.endStage(activeTurnId, 'stt');
        this.emit(
          'pipeline:stt:final',
          this.createEvent('pipeline:stt:final', turn.sessionId, {
            turnId: activeTurnId,
            transcript: utterance.transcript,
            confidence: utterance.confidence,
          }),
        );

        span?.end();
        await this.processWithMCP(turn.sessionId, activeTurnId, utterance.transcript);
      } else {
        this.emit(
          'pipeline:stt:interim',
          this.createEvent('pipeline:stt:interim', turn.sessionId, {
            turnId: activeTurnId,
            transcript: utterance.transcript,
            confidence: utterance.confidence,
          }),
        );
      }
    } catch (error) {
      if (createdTurnId) {
        this.activeTurns.delete(createdTurnId);
        this.dependencies.latencyEnforcer.endTurn(createdTurnId);
      }
      span?.recordException(error as Error);
      span?.end();
      throw error;
    }
  }

  private async handleEndOfSpeech(): Promise<void> {
    this.emit('pipeline:stt:eos', this.createEvent('pipeline:stt:eos', 'unknown'));

    // Find and complete any pending turns
    for (const [turnId, turn] of this.activeTurns.entries()) {
      if (turn.isProcessing && turn.utterances.length > 0) {
        const lastUtterance = turn.utterances[turn.utterances.length - 1];

        if (lastUtterance && !lastUtterance.isFinal) {
          // Force final utterance
          lastUtterance.isFinal = true;
          this.dependencies.latencyEnforcer.endStage(turnId, 'stt');

          await this.processWithMCP(turn.sessionId, turnId, lastUtterance.transcript);
        }
      }
    }
  }

  private async processWithMCP(
    sessionId: string,
    turnId: string,
    utterance: string,
  ): Promise<void> {
    const observability = getObservability();
    const session = this.dependencies.sessionManager.getSession(sessionId);

    if (!session) {
      return;
    }

    const span = observability.startSpan(
      'voice.mcp',
      {
        sessionId,
        turnId,
        provider: 'mcp-client',
        endpoint: session.mcpEndpoint,
      },
      SpanKind.CLIENT,
    );

    this.dependencies.latencyEnforcer.startStage(turnId, 'mcp');
    this.emit(
      'pipeline:mcp:request',
      this.createEvent('pipeline:mcp:request', sessionId, {
        turnId,
        utterance,
      }),
    );

    // Start thinking audio if configured
    const thinkingAudio = this.dependencies.thinkingAudioManager;
    if (thinkingAudio && this.dependencies.config.thinkingAudio?.enabled) {
      this.emit(
        'pipeline:thinking:start',
        this.createEvent('pipeline:thinking:start', sessionId, { turnId }),
      );
      void thinkingAudio.startThinking(turnId);
    }

    try {
      const history: Array<{ role: string; content: string }> = [];
      for (const turn of this.dependencies.sessionManager.getConversationHistory(sessionId)) {
        history.push({ role: 'user', content: turn.userUtterance });
        history.push({ role: 'assistant', content: turn.agentResponse });
      }

      const response = await this.dependencies.mcpClient.sendRequest({
        sessionId,
        turnId,
        utterance,
        history,
      });

      // Stop thinking audio before TTS
      if (thinkingAudio) {
        thinkingAudio.stopThinking(turnId);
        this.emit(
          'pipeline:thinking:stop',
          this.createEvent('pipeline:thinking:stop', sessionId, { turnId }),
        );
      }

      this.dependencies.latencyEnforcer.endStage(turnId, 'mcp');
      span?.setAttribute('response_length', response.text.length);
      span?.setAttribute('tool_calls_count', response.toolCalls.length);
      this.emit(
        'pipeline:mcp:response',
        this.createEvent('pipeline:mcp:response', sessionId, {
          turnId,
          response: response.text,
          latencyMs: response.latencyMs,
        }),
      );

      span?.end();
      await this.processWithTTS(sessionId, turnId, response);
    } catch (error) {
      if (thinkingAudio) {
        thinkingAudio.stopThinking(turnId);
        this.emit(
          'pipeline:thinking:stop',
          this.createEvent('pipeline:thinking:stop', sessionId, { turnId }),
        );
      }

      this.dependencies.latencyEnforcer.endStage(turnId, 'mcp');
      span?.recordException(error as Error);
      span?.end();
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          turnId,
          error: String(error),
          stage: 'mcp',
        }),
      );

      this.activeTurns.delete(turnId);
    }
  }

  private async processWithTTS(
    sessionId: string,
    turnId: string,
    response: AgentResponse,
  ): Promise<void> {
    const observability = getObservability();
    const span = observability.startSpan(
      'voice.tts',
      {
        sessionId,
        turnId,
        provider: this.dependencies.config.tts.provider,
        voice:
          typeof this.dependencies.config.tts.voice === 'string'
            ? this.dependencies.config.tts.voice
            : undefined,
        textLength: response.text.length,
      },
      SpanKind.CLIENT,
    );

    this.dependencies.latencyEnforcer.startStage(turnId, 'tts');
    this.emit(
      'pipeline:tts:start',
      this.createEvent('pipeline:tts:start', sessionId, {
        turnId,
        text: response.text,
      }),
    );

    this.activeTTSTurnId = turnId;
    this.ttsCancelled = false;

    try {
      const config = this.dependencies.config.tts;
      let firstByteEmitted = false;
      const audioChunks: AudioChunk[] = [];

      for await (const chunk of this.dependencies.ttsProvider.synthesize(response.text, config)) {
        if (this.ttsCancelled) {
          break;
        }
        if (!firstByteEmitted) {
          this.dependencies.latencyEnforcer.endStage(turnId, 'tts');
          const firstByteLatency =
            performance.now() - (this.activeTurns.get(turnId)?.startTime ?? 0);
          span?.setAttribute('first_byte_latency_ms', firstByteLatency);
          observability.ttsFirstByteLatency.record(firstByteLatency, { session_id: sessionId });
          this.emit(
            'pipeline:tts:first_byte',
            this.createEvent('pipeline:tts:first_byte', sessionId, {
              turnId,
              latencyMs: firstByteLatency,
            }),
          );
          firstByteEmitted = true;
        }

        audioChunks.push(chunk);
        this.dependencies.recordingManager?.recordAudioChunk(sessionId, chunk, 'outbound');
        this.emit(
          'pipeline:tts:chunk',
          this.createEvent('pipeline:tts:chunk', sessionId, {
            turnId,
            chunkSize: chunk.buffer.length,
            chunk,
          }),
        );
      }

      span?.setAttribute('total_chunks', audioChunks.length);
      span?.setAttribute(
        'total_audio_bytes',
        audioChunks.reduce((sum, c) => sum + c.buffer.length, 0),
      );
      this.emit(
        'pipeline:tts:complete',
        this.createEvent('pipeline:tts:complete', sessionId, {
          turnId,
          totalChunks: audioChunks.length,
        }),
      );

      const session = this.dependencies.sessionManager.getSession(sessionId);

      if (session) {
        this.dependencies.sessionManager.addTurn(sessionId, {
          userUtterance: this.activeTurns.get(turnId)?.utterances[0]?.transcript ?? '',
          agentResponse: response.text,
          timestamp: new Date(),
          latencyMs: performance.now() - (this.activeTurns.get(turnId)?.startTime ?? 0),
          toolCalls: response.toolCalls,
        });
      }

      const metrics = this.dependencies.latencyEnforcer.endTurn(turnId);
      observability.recordTurnMetrics({
        sessionId,
        turnId,
        sttLatencyMs: metrics.sttLatencyMs,
        mcpLatencyMs: metrics.mcpLatencyMs,
        ttsFirstByteMs: metrics.ttsFirstByteMs,
        totalLatencyMs: metrics.totalTurnLatencyMs,
        budgetExceeded: metrics.budgetExceeded,
        exceededStages: metrics.exceededStages,
      });

      const turnStartTime = this.activeTurns.get(turnId)?.startTime ?? Date.now();
      const turnUserUtterance = this.activeTurns.get(turnId)?.utterances[0]?.transcript ?? '';

      if (this.dependencies.recordingManager?.isEnabled()) {
        const turnRecord: TurnRecord = {
          turnId,
          userUtterance: turnUserUtterance,
          agentResponse: response.text,
          userAudio: [],
          agentAudio: audioChunks,
          startTime: turnStartTime,
          endTime: performance.now(),
          latencyMs: metrics.totalTurnLatencyMs,
          toolCalls: response.toolCalls,
          cost: undefined,
        };

        const costTracker = this.dependencies.costTracker;
        if (costTracker && this.dependencies.config.cost?.enabled) {
          const provider = this.dependencies.config.stt.provider;
          costTracker.setTurnProvider(sessionId, turnId, provider);
          costTracker.trackTTSUsage(sessionId, turnId, response.text.length);

          const sttDurationMs = metrics.sttLatencyMs > 0 ? metrics.sttLatencyMs : 200;
          costTracker.trackSTTUsage(sessionId, turnId, sttDurationMs);

          costTracker.trackMCPUsage(
            sessionId,
            turnId,
            turnUserUtterance.length,
            response.text.length,
          );

          const turnCost = costTracker.getTurnCost(sessionId, turnId);
          turnRecord.cost = turnCost;

          observability.recordTurnCost({
            sessionId,
            turnId,
            costCents: Math.round(turnCost.totalCost * 100),
            sttCostCents: Math.round(turnCost.sttCost * 100),
            ttsCostCents: Math.round(turnCost.ttsCost * 100),
            mcpCostCents: Math.round(turnCost.mcpCost * 100),
          });

          const costPerMinute = costTracker.getAverageCostPerMinute();
          observability.recordCostPerMinute(sessionId, Math.round(costPerMinute * 100));
        }

        this.dependencies.recordingManager?.recordTurn(sessionId, turnRecord);
      }

      this.emit(
        'pipeline:turn:end',
        this.createEvent('pipeline:turn:end', sessionId, {
          turnId,
          metrics,
        }),
      );

      span?.end();
      this.activeTurns.delete(turnId);
      if (this.activeTTSTurnId === turnId) {
        this.activeTTSTurnId = undefined;
        this.ttsCancelled = false;
      }
    } catch (error) {
      this.dependencies.latencyEnforcer.endStage(turnId, 'tts');
      span?.recordException(error as Error);
      span?.end();
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          turnId,
          error: String(error),
          stage: 'tts',
        }),
      );

      this.activeTurns.delete(turnId);
      if (this.activeTTSTurnId === turnId) {
        this.activeTTSTurnId = undefined;
        this.ttsCancelled = false;
      }
    }
  }

  async endSession(sessionId: string): Promise<void> {
    this.emit('pipeline:end', this.createEvent('pipeline:end', sessionId));

    try {
      await this.dependencies.sttProvider.close();
      await this.dependencies.ttsProvider.close?.();
      await this.dependencies.mcpClient.close();
    } catch (error) {
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, { error: String(error) }),
      );
    }

    void this.dependencies.recordingManager?.stopRecording(sessionId);
    this.dependencies.costTracker?.endSession(sessionId);

    // Clean up active turns for this session
    for (const [turnId, turn] of this.activeTurns.entries()) {
      if (turn.sessionId === sessionId) {
        this.activeTurns.delete(turnId);
      }
    }

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
      this.activeTTSTurnId = undefined;
      this.ttsCancelled = false;
    }
  }

  private getActiveSessionId(): string | undefined {
    if (this.currentSessionId) {
      const session = this.dependencies.sessionManager.getSession(this.currentSessionId);
      if (session && session.status === 'active') {
        return this.currentSessionId;
      }
    }
    const sessions = this.dependencies.sessionManager.getAllSessions();
    const activeSession = sessions.find((s) => s.status === 'active');
    return activeSession?.sessionId;
  }

  private createEvent(
    type: string,
    sessionId: string,
    data?: Record<string, unknown>,
  ): PipelineEvent {
    return {
      type: type as PipelineEvent['type'],
      sessionId,
      timestamp: Date.now(),
      data,
    };
  }

  processDTMFInput(sessionId: string, digit: string): void {
    if (!this.dtmfEnabled) {
      return;
    }

    const now = Date.now();

    this.emit(
      'pipeline:dtmf:received',
      this.createEvent('pipeline:dtmf:received', sessionId, {
        digit,
        sequence: this.dtmfSequence + digit,
      }),
    );

    // Reset sequence if this is a new call or timeout elapsed
    const lastDigitTime = this.dtmfDigitTimes[this.dtmfDigitTimes.length - 1];
    if (
      this.dtmfSequenceCallSid !== sessionId ||
      (lastDigitTime && now - lastDigitTime > this.dtmfInterDigitTimeout)
    ) {
      this.resetDTMFState();
    }

    this.dtmfSequenceCallSid = sessionId;
    this.dtmfSequence += digit;
    this.dtmfDigitTimes.push(now);

    // Check terminator
    if (digit === this.dtmfTerminatorDigit) {
      // Remove terminator from sequence
      const sequence = this.dtmfSequence.slice(0, -1);
      this.finalizeDTMFSequence(sessionId, sequence);
      return;
    }

    // Check max digits
    if (this.dtmfSequence.length >= this.dtmfMaxDigits) {
      this.finalizeDTMFSequence(sessionId, this.dtmfSequence);
      return;
    }

    // Reset inter-digit timeout
    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
    }

    this.dtmfTimer = setTimeout(() => {
      this.finalizeDTMFSequence(sessionId, this.dtmfSequence);
    }, this.dtmfInterDigitTimeout);
    this.dtmfTimer.unref?.();
  }

  private finalizeDTMFSequence(sessionId: string, sequence: string): void {
    this.emit(
      'pipeline:dtmf:complete',
      this.createEvent('pipeline:dtmf:complete', sessionId, {
        sequence,
        digitCount: sequence.length,
      }),
    );

    if (sequence.length > 0) {
      void this.processMCPWithDTMF(sessionId, sequence);
    }

    this.resetDTMFState();
  }

  private async processMCPWithDTMF(sessionId: string, sequence: string): Promise<void> {
    const session = this.dependencies.sessionManager.getSession(sessionId);

    if (!session) {
      return;
    }

    const turnId = uuidv4();

    this.dependencies.latencyEnforcer.startTurn(turnId);
    this.dependencies.latencyEnforcer.startStage(turnId, 'mcp');

    this.emit(
      'pipeline:mcp:request',
      this.createEvent('pipeline:mcp:request', sessionId, {
        turnId,
        utterance: `[DTMF:${sequence}]`,
        dtmfSequence: sequence,
      }),
    );

    try {
      const history: Array<{ role: string; content: string }> = [];
      for (const turn of this.dependencies.sessionManager.getConversationHistory(sessionId)) {
        history.push({ role: 'user', content: turn.userUtterance });
        history.push({ role: 'assistant', content: turn.agentResponse });
      }

      const response = await this.dependencies.mcpClient.sendRequest({
        sessionId,
        turnId,
        utterance: `[DTMF:${sequence}]`,
        history,
      });

      this.dependencies.latencyEnforcer.endStage(turnId, 'mcp');
      this.emit(
        'pipeline:mcp:response',
        this.createEvent('pipeline:mcp:response', sessionId, {
          turnId,
          response: response.text,
          latencyMs: response.latencyMs,
        }),
      );

      await this.processWithTTS(sessionId, turnId, response);
    } catch (error) {
      this.dependencies.latencyEnforcer.endStage(turnId, 'mcp');
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          turnId,
          error: String(error),
          stage: 'dtmf-mcp',
        }),
      );
    }
  }

  private resetDTMFState(): void {
    this.dtmfSequence = '';
    this.dtmfSequenceCallSid = '';
    this.dtmfDigitTimes = [];

    if (this.dtmfTimer) {
      clearTimeout(this.dtmfTimer);
      this.dtmfTimer = undefined;
    }
  }

  private setupVADCheck(): void {
    const vadProvider = this.dependencies.vadProvider;
    if (!vadProvider) {
      return;
    }

    this.vadCheckInterval = setInterval(() => {
      if (!this.currentSessionId) {
        return;
      }

      const result = vadProvider.checkEndpoint([]);

      if (result.isEndpoint) {
        this.emit(
          'pipeline:vad:endpoint',
          this.createEvent('pipeline:vad:endpoint', this.currentSessionId, {
            reason: result.reason,
            confidence: result.confidence,
            silenceDurationMs: result.silenceDurationMs,
            totalSpeechDurationMs: result.totalSpeechDurationMs,
          }),
        );

        this.emit('pipeline:stt:eos', this.createEvent('pipeline:stt:eos', this.currentSessionId));

        // Find and complete any pending turns
        for (const [turnId, turn] of this.activeTurns.entries()) {
          if (turn.isProcessing && turn.utterances.length > 0) {
            const lastUtterance = turn.utterances[turn.utterances.length - 1];

            if (lastUtterance && !lastUtterance.isFinal) {
              lastUtterance.isFinal = true;
              this.dependencies.latencyEnforcer.endStage(turnId, 'stt');
              void this.processWithMCP(turn.sessionId, turnId, lastUtterance.transcript);
            }
          }
        }
      }
    }, 100);
    this.vadCheckInterval.unref?.();
  }

  destroy(): void {
    if (this.vadCheckInterval) {
      clearInterval(this.vadCheckInterval);
      this.vadCheckInterval = undefined;
    }

    this.resetDTMFState();
    this.activeTurns.clear();
    this.removeAllListeners();
  }
}

// Factory function to create a pipeline
export function createPipeline(dependencies: PipelineDependencies): Pipeline {
  return new Pipeline(dependencies);
}

// Factory function that selects pipeline based on config mode
export function createPipelineForMode(
  stagedDeps: PipelineDependencies,
  s2sDeps?: S2SPipelineDependencies,
): Pipeline | SpeechToSpeechPipeline {
  if (stagedDeps.config.mode === 'speech-to-speech') {
    if (!s2sDeps) {
      throw new Error('S2S pipeline dependencies are required when mode is "speech-to-speech"');
    }
    return new SpeechToSpeechPipeline(s2sDeps);
  }
  return new Pipeline(stagedDeps);
}
