import type { Span, Tracer, SpanKind } from '@opentelemetry/api';
import { SpanKind as SK, metrics, SpanStatusCode as SC, trace } from '@opentelemetry/api';

export interface ObservabilityConfig {
  serviceName: string;
  serviceVersion: string;
  enabled: boolean;
  otlpEndpoint?: string;
}

export interface SpanAttributes {
  sessionId?: string;
  turnId?: string;
  provider?: string;
  model?: string;
  language?: string;
  [key: string]: string | number | boolean | undefined;
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  serviceName: 'voice-agent-kit',
  serviceVersion: '0.1.0',
  enabled: true,
};

class Observability {
  private config: ObservabilityConfig;
  private initialized = false;

  private meter = metrics.getMeter('voice-agent-kit');
  private tracer: Tracer = trace.getTracer('voice-agent-kit');

  public voiceTurnDuration = this.meter.createHistogram('voice.turn.duration_ms', {
    description: 'End-to-end duration per turn in milliseconds',
    unit: 'ms',
  });

  public sttLatency = this.meter.createHistogram('voice.stt.latency_ms', {
    description: 'Time to final transcript in milliseconds',
    unit: 'ms',
  });

  public ttsFirstByteLatency = this.meter.createHistogram('voice.tts.first_byte_ms', {
    description: 'Time to first audio byte from TTS in milliseconds',
    unit: 'ms',
  });

  public mcpLatency = this.meter.createHistogram('voice.mcp.latency_ms', {
    description: 'MCP round-trip time in milliseconds',
    unit: 'ms',
  });

  public bargeInCount = this.meter.createCounter('voice.barge_in.count', {
    description: 'Number of barge-in events',
  });

  public activeSessions = this.meter.createUpDownCounter('voice.session.active', {
    description: 'Number of active sessions',
  });

  public latencyBudgetExceeded = this.meter.createCounter('voice.latency_budget.exceeded', {
    description: 'Counter for latency budget exceeded events with stage label',
  });

  constructor(config: Partial<ObservabilityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.config.enabled) {
      return;
    }

    // Observability initialized - OTLP endpoint: ${this.config.otlpEndpoint || 'none'}

    this.initialized = true;
  }

  startSpan(
    name: string,
    attributes?: SpanAttributes,
    kind: SpanKind = SK.INTERNAL
  ): Span | null {
    if (!this.config.enabled) {
      return null;
    }

    const span = this.tracer.startSpan(name, { kind });
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      }
    }
    return span;
  }

  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
    attributes?: SpanAttributes,
    _kind: SpanKind = SK.INTERNAL
  ): T {
    const span = this.startSpan(name, attributes);
    if (!span) {
      return fn({} as Span);
    }

    try {
      const result = fn(span);
      span.setStatus({ code: SC.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SC.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  }

  withSpan<T>(name: string, fn: (span: Span | null) => Promise<T>, attributes?: SpanAttributes): Promise<T> {
    const span = this.startSpan(name, attributes);

    return (async () => {
      try {
        const result = await fn(span);
        if (span) {
          span.setStatus({ code: SC.OK });
        }
        return result;
      } catch (error) {
        if (span) {
          span.recordException(error as Error);
          span.setStatus({ code: SC.ERROR, message: String(error) });
        }
        throw error;
      } finally {
        if (span) {
          span.end();
        }
      }
    })();
  }

  recordTurnMetrics(params: {
    sessionId: string;
    turnId: string;
    sttLatencyMs: number;
    mcpLatencyMs: number;
    ttsFirstByteMs: number;
    totalLatencyMs: number;
    budgetExceeded: boolean;
    exceededStages: string[];
  }): void {
    const { sessionId, sttLatencyMs, mcpLatencyMs, ttsFirstByteMs, totalLatencyMs, budgetExceeded, exceededStages } = params;

    this.voiceTurnDuration.record(totalLatencyMs, { session_id: sessionId });
    this.sttLatency.record(sttLatencyMs, { session_id: sessionId });
    this.mcpLatency.record(mcpLatencyMs, { session_id: sessionId });
    this.ttsFirstByteLatency.record(ttsFirstByteMs, { session_id: sessionId });

    if (budgetExceeded) {
      for (const stage of exceededStages) {
        this.latencyBudgetExceeded.add(1, { stage, session_id: sessionId });
      }
    }
  }

  recordBargeIn(sessionId: string): void {
    this.bargeInCount.add(1, { session_id: sessionId });
  }

  incrementActiveSessions(): void {
    this.activeSessions.add(1);
  }

  decrementActiveSessions(): void {
    this.activeSessions.add(-1);
  }

  getTracer(): Tracer {
    return this.tracer;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}

let globalObservability: Observability | null = null;

export function initializeObservability(config?: Partial<ObservabilityConfig>): Promise<void> {
  globalObservability = new Observability(config);
  return globalObservability.initialize();
}

export function getObservability(): Observability {
  if (!globalObservability) {
    globalObservability = new Observability();
  }
  return globalObservability;
}

export function shutdownObservability(): Promise<void> {
  if (globalObservability) {
    return globalObservability.shutdown();
  }
  return Promise.resolve();
}

export { Observability };
export default Observability;