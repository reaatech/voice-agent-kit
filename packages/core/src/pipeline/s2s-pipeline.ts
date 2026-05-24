import { SpanKind } from '@opentelemetry/api';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import type { LatencyBudgetEnforcer } from '../latency/index.js';
import { getObservability } from '../observability/index.js';
import type { SessionManager } from '../session/index.js';
import type {
  AgentResponse,
  AudioChunk,
  PipelineEvent,
  SpeechToSpeechConfig,
  Utterance,
  VoiceAgentKitConfig,
} from '../types/index.js';

export interface S2SProvider {
  readonly name: string;
  connect(config: SpeechToSpeechConfig): Promise<void>;
  sendAudio(chunk: AudioChunk): void;
  close(): Promise<void>;

  onAudioOutput(cb: (chunk: AudioChunk) => void): void;
  onTranscript(cb: (utterance: Utterance) => void): void;
  onTurnComplete(cb: (response: AgentResponse) => void): void;
  onError(cb: (error: Error) => void): void;
  onEndOfTurn(cb: () => void): void;
}

export interface S2SPipelineDependencies {
  sessionManager: SessionManager;
  latencyEnforcer: LatencyBudgetEnforcer;
  provider: S2SProvider;
  config: VoiceAgentKitConfig;
}

interface ActiveS2STurn {
  sessionId: string;
  turnId: string;
  startTime: number;
  utterances: Utterance[];
  audioChunks: AudioChunk[];
  agentResponse?: AgentResponse;
}

export class SpeechToSpeechPipeline extends EventEmitter {
  private readonly dependencies: S2SPipelineDependencies;
  private readonly activeTurns: Map<string, ActiveS2STurn> = new Map();
  private currentSessionId?: string;
  private activeOutputTurnId?: string;
  private bargeInRequested = false;
  private connected = false;

  constructor(dependencies: S2SPipelineDependencies) {
    super();
    this.dependencies = dependencies;
    this.setupProviderListeners();
  }

  private setupProviderListeners(): void {
    const { provider } = this.dependencies;

    provider.onAudioOutput((chunk: AudioChunk) => {
      if (this.bargeInRequested) {
        return;
      }

      const sessionId = this.getActiveSessionId();
      if (!sessionId) {
        return;
      }

      const turnId = this.activeOutputTurnId;
      if (turnId) {
        const turn = this.activeTurns.get(turnId);
        if (turn) {
          turn.audioChunks.push(chunk);
        }
      }

      this.emit(
        'pipeline:tts:chunk',
        this.createEvent('pipeline:tts:chunk', sessionId, {
          turnId,
          chunkSize: chunk.buffer.length,
          chunk,
        }),
      );
    });

    provider.onTranscript((utterance: Utterance) => {
      const sessionId = this.getActiveSessionId();
      if (!sessionId) {
        return;
      }

      let turnId: string | undefined;

      if (utterance.isFinal && this.activeOutputTurnId) {
        turnId = this.activeOutputTurnId;
        const turn = this.activeTurns.get(turnId);
        if (turn) {
          turn.utterances.push(utterance);
          turn.agentResponse = {
            text: utterance.transcript,
            toolCalls: [],
            latencyMs: performance.now() - turn.startTime,
            confidence: utterance.confidence,
          };
        }
      }

      const eventType = utterance.isFinal ? 'pipeline:stt:final' : 'pipeline:stt:interim';
      this.emit(
        eventType,
        this.createEvent(eventType, sessionId, {
          turnId,
          transcript: utterance.transcript,
          confidence: utterance.confidence,
        }),
      );
    });

    provider.onTurnComplete((response: AgentResponse) => {
      void this.handleTurnComplete(response);
    });

    provider.onEndOfTurn(() => {
      const sessionId = this.getActiveSessionId();
      if (sessionId) {
        this.emit('pipeline:stt:eos', this.createEvent('pipeline:stt:eos', sessionId));
      }
    });

    provider.onError((error: Error) => {
      const sessionId = this.getActiveSessionId() ?? 'unknown';
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          error: error.message,
          stage: 'speech-to-speech',
        }),
      );
    });
  }

  async startSession(session: { sessionId: string; status: string }): Promise<void> {
    this.currentSessionId = session.sessionId;
    this.emit('pipeline:start', this.createEvent('pipeline:start', session.sessionId));

    const s2sConfig = this.dependencies.config.speechToSpeech;

    if (!s2sConfig) {
      throw new Error(
        'SpeechToSpeech config is required when using speech-to-speech pipeline mode',
      );
    }

    const observability = getObservability();
    observability.incrementActiveSessions();

    try {
      await this.dependencies.provider.connect(s2sConfig);
      this.connected = true;
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

  async processAudioChunk(sessionId: string, chunk: AudioChunk): Promise<void> {
    const session = this.dependencies.sessionManager.getSession(sessionId);

    if (!session || session.status !== 'active') {
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          error: 'Session not found or inactive',
        }),
      );
      return;
    }

    this.dependencies.provider.sendAudio(chunk);
  }

  bargeIn(sessionId: string): void {
    if (this.currentSessionId !== sessionId && this.currentSessionId !== undefined) {
      return;
    }

    this.bargeInRequested = true;

    if (this.activeOutputTurnId) {
      const observability = getObservability();
      observability.recordBargeIn(sessionId);

      this.emit(
        'pipeline:barge_in',
        this.createEvent('pipeline:barge_in', sessionId, {
          turnId: this.activeOutputTurnId,
        }),
      );
    }

    this.dependencies.provider.close().catch(() => {
      this.connected = false;
    });

    if (this.activeOutputTurnId) {
      this.activeTurns.delete(this.activeOutputTurnId);
      this.activeOutputTurnId = undefined;
    }

    this.bargeInRequested = false;
  }

  async endSession(sessionId: string): Promise<void> {
    this.emit('pipeline:end', this.createEvent('pipeline:end', sessionId));

    const observability = getObservability();

    try {
      await this.dependencies.provider.close();
      this.connected = false;
      observability.decrementActiveSessions();
    } catch (error) {
      this.emit(
        'pipeline:error',
        this.createEvent('pipeline:error', sessionId, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    for (const [turnId, turn] of this.activeTurns.entries()) {
      if (turn.sessionId === sessionId) {
        this.activeTurns.delete(turnId);
      }
    }

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
      this.activeOutputTurnId = undefined;
      this.bargeInRequested = false;
    }
  }

  private async handleTurnComplete(response: AgentResponse): Promise<void> {
    const observability = getObservability();
    const sessionId = this.getActiveSessionId();

    if (!sessionId) {
      return;
    }

    const span = observability.startSpan(
      'voice.s2s.turn_complete',
      {
        sessionId,
        provider: this.dependencies.config.speechToSpeech?.provider,
      },
      SpanKind.INTERNAL,
    );

    const session = this.dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      span?.end();
      return;
    }

    const turnId = uuidv4();
    const startTime = performance.now();

    this.dependencies.latencyEnforcer.startTurn(turnId);
    this.dependencies.latencyEnforcer.startStage(turnId, 'stt');
    this.dependencies.latencyEnforcer.endStage(turnId, 'stt');
    this.dependencies.latencyEnforcer.startStage(turnId, 'mcp');
    this.dependencies.latencyEnforcer.endStage(turnId, 'mcp');

    this.emit(
      'pipeline:mcp:response',
      this.createEvent('pipeline:mcp:response', sessionId, {
        turnId,
        response: response.text,
        latencyMs: response.latencyMs,
      }),
    );

    span?.setAttribute('response_length', response.text.length);
    span?.setAttribute('tool_calls_count', response.toolCalls.length);

    this.activeOutputTurnId = turnId;
    this.activeTurns.set(turnId, {
      sessionId,
      turnId,
      startTime,
      utterances: [],
      audioChunks: [],
      agentResponse: response,
    });

    this.emit(
      'pipeline:tts:start',
      this.createEvent('pipeline:tts:start', sessionId, {
        turnId,
        text: response.text,
      }),
    );

    const s2sConfig = this.dependencies.config.speechToSpeech;
    if (s2sConfig?.provider) {
      observability.ttsFirstByteLatency.record(response.latencyMs, { session_id: sessionId });
    }

    if (session) {
      this.dependencies.sessionManager.addTurn(sessionId, {
        userUtterance: response.text
          ? `[S2S Response: ${response.text.slice(0, 100)}]`
          : '[S2S Audio Response]',
        agentResponse: response.text,
        timestamp: new Date(),
        latencyMs: response.latencyMs,
        toolCalls: response.toolCalls,
      });
    }

    if (!span?.isRecording()) {
      span?.end();
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

    this.emit(
      'pipeline:tts:complete',
      this.createEvent('pipeline:tts:complete', sessionId, {
        turnId,
        totalChunks: this.activeTurns.get(turnId)?.audioChunks.length ?? 0,
      }),
    );

    this.emit(
      'pipeline:turn:end',
      this.createEvent('pipeline:turn:end', sessionId, {
        turnId,
        metrics,
      }),
    );

    this.activeOutputTurnId = undefined;

    span?.end();
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

  destroy(): void {
    if (this.connected) {
      this.dependencies.provider.close().catch(() => {
        this.connected = false;
      });
    }
    this.connected = false;
    this.activeTurns.clear();
    this.removeAllListeners();
  }
}

export function createSpeechToSpeechPipeline(
  dependencies: S2SPipelineDependencies,
): SpeechToSpeechPipeline {
  return new SpeechToSpeechPipeline(dependencies);
}
