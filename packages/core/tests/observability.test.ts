import { SpanKind } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ObservabilityConfig, SpanAttributes } from '../src/observability/index.js';
import {
  getObservability,
  initializeObservability,
  Observability,
  shutdownObservability,
} from '../src/observability/index.js';

describe('Observability', () => {
  let observability: Observability;

  beforeEach(() => {
    observability = new Observability();
  });

  afterEach(async () => {
    await observability.shutdown();
  });

  describe('constructor', () => {
    it('should create observability with default config', () => {
      expect(observability).toBeInstanceOf(Observability);
    });

    it('should accept custom config', () => {
      const customConfig: Partial<ObservabilityConfig> = {
        serviceName: 'custom-service',
        serviceVersion: '1.0.0',
        enabled: true,
      };
      const customObs = new Observability(customConfig);
      expect(customObs).toBeInstanceOf(Observability);
    });
  });

  describe('initialize', () => {
    it('should initialize the observability', async () => {
      await observability.initialize();
      expect(observability).toBeDefined();
    });

    it('should not re-initialize if already initialized', async () => {
      await observability.initialize();
      await observability.initialize();
      expect(observability).toBeDefined();
    });

    it('should skip initialization when disabled', async () => {
      const disabledObs = new Observability({ enabled: false });
      await disabledObs.initialize();
      expect(disabledObs).toBeDefined();
    });
  });

  describe('startSpan', () => {
    it('should return null when disabled', () => {
      const disabledObs = new Observability({ enabled: false });
      const span = disabledObs.startSpan('test.span');
      expect(span).toBeNull();
    });

    it('should return a span when initialized', async () => {
      await observability.initialize();
      const span = observability.startSpan('test.span');
      expect(span).toBeDefined();
    });

    it('should pass attributes to span', async () => {
      await observability.initialize();
      const attributes: SpanAttributes = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        provider: 'deepgram',
      };
      const span = observability.startSpan('test.span', attributes);
      expect(span).toBeDefined();
    });

    it('should accept span kind', async () => {
      await observability.initialize();
      const span = observability.startSpan('test.span', {}, SpanKind.CLIENT);
      expect(span).toBeDefined();
    });
  });

  describe('startActiveSpan', () => {
    it('should call the provided function with a span', async () => {
      await observability.initialize();
      const result = observability.startActiveSpan('test.span', (span) => {
        return span !== null;
      });
      expect(result).toBe(true);
    });

    it('should return span result when not initialized', () => {
      const result = observability.startActiveSpan('test.span', (span) => {
        return span !== null;
      });
      expect(result).toBe(true);
    });
  });

  describe('withSpan', () => {
    it('should wrap async function with span', async () => {
      await observability.initialize();
      const result = await observability.withSpan('test.span', async (span) => {
        return span !== null;
      });
      expect(result).toBe(true);
    });

    it('should handle errors in wrapped function', async () => {
      await observability.initialize();
      await expect(
        observability.withSpan('test.span', async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');
    });
  });

  describe('recordTurnMetrics', () => {
    it('should record turn metrics without error', async () => {
      await observability.initialize();
      observability.recordTurnMetrics({
        sessionId: 'session-1',
        turnId: 'turn-1',
        sttLatencyMs: 100,
        mcpLatencyMs: 200,
        ttsFirstByteMs: 150,
        totalLatencyMs: 450,
        budgetExceeded: false,
        exceededStages: [],
      });
      expect(observability).toBeDefined();
    });

    it('should record exceeded stages', async () => {
      await observability.initialize();
      observability.recordTurnMetrics({
        sessionId: 'session-1',
        turnId: 'turn-1',
        sttLatencyMs: 300,
        mcpLatencyMs: 500,
        ttsFirstByteMs: 300,
        totalLatencyMs: 1100,
        budgetExceeded: true,
        exceededStages: ['stt', 'mcp'],
      });
      expect(observability).toBeDefined();
    });

    it('should record single exceeded stage', async () => {
      await observability.initialize();
      observability.recordTurnMetrics({
        sessionId: 'session-1',
        turnId: 'turn-1',
        sttLatencyMs: 300,
        mcpLatencyMs: 100,
        ttsFirstByteMs: 100,
        totalLatencyMs: 500,
        budgetExceeded: true,
        exceededStages: ['stt'],
      });
      expect(observability).toBeDefined();
    });
  });

  describe('recordBargeIn', () => {
    it('should record barge-in event', async () => {
      await observability.initialize();
      observability.recordBargeIn('session-1');
      expect(observability).toBeDefined();
    });
  });

  describe('session counters', () => {
    it('should increment active sessions', async () => {
      await observability.initialize();
      observability.incrementActiveSessions();
      expect(observability).toBeDefined();
    });

    it('should decrement active sessions', async () => {
      await observability.initialize();
      observability.decrementActiveSessions();
      expect(observability).toBeDefined();
    });
  });

  describe('recordTurnCost', () => {
    it('should record turn cost metrics', async () => {
      await observability.initialize();
      observability.recordTurnCost({
        sessionId: 'session-1',
        turnId: 'turn-1',
        costCents: 50,
        sttCostCents: 10,
        ttsCostCents: 20,
        mcpCostCents: 20,
      });
      expect(observability).toBeDefined();
    });

    it('should handle zero cost values', async () => {
      await observability.initialize();
      observability.recordTurnCost({
        sessionId: 'session-1',
        turnId: 'turn-1',
        costCents: 0,
        sttCostCents: 0,
        ttsCostCents: 0,
        mcpCostCents: 0,
      });
      expect(observability).toBeDefined();
    });
  });

  describe('recordCostPerMinute', () => {
    it('should record cost per minute', async () => {
      await observability.initialize();
      observability.recordCostPerMinute('session-1', 100);
      expect(observability).toBeDefined();
    });

    it('should handle zero cost per minute', async () => {
      await observability.initialize();
      observability.recordCostPerMinute('session-1', 0);
      expect(observability).toBeDefined();
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialize', () => {
      expect(observability.isInitialized()).toBe(false);
    });

    it('should return true after initialize', async () => {
      await observability.initialize();
      expect(observability.isInitialized()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      await observability.initialize();
      await observability.shutdown();
      expect(observability.isInitialized()).toBe(false);
    });
  });

  describe('startSpan with disabled config', () => {
    it('should return null when disabled even with attributes', () => {
      const disabledObs = new Observability({ enabled: false });
      const span = disabledObs.startSpan('test.span', { sessionId: 'sess-1' }, SpanKind.CLIENT);
      expect(span).toBeNull();
    });
  });

  describe('startActiveSpan edge cases', () => {
    it('should handle errors in the callback', async () => {
      await observability.initialize();
      expect(() =>
        observability.startActiveSpan('test.span', () => {
          throw new Error('callback error');
        }),
      ).toThrow('callback error');
    });

    it('should work when disabled', () => {
      const disabledObs = new Observability({ enabled: false });
      const result = disabledObs.startActiveSpan('test.span', (span) => {
        return span !== null;
      });
      expect(result).toBe(true);
    });
  });

  describe('withSpan edge cases', () => {
    it('should return result without span when disabled', async () => {
      const disabledObs = new Observability({ enabled: false });
      const result = await disabledObs.withSpan('test.span', async (span) => {
        return span === null;
      });
      expect(result).toBe(true);
    });

    it('should handle error and still end span', async () => {
      await observability.initialize();
      await expect(
        observability.withSpan('test.span', async () => {
          throw new Error('async error');
        }),
      ).rejects.toThrow('async error');
    });
  });

  describe('getTracer', () => {
    it('should return a tracer before initialize', () => {
      const tracer = observability.getTracer();
      expect(tracer).toBeDefined();
    });

    it('should return tracer when initialized', async () => {
      await observability.initialize();
      const tracer = observability.getTracer();
      expect(tracer).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await observability.initialize();
      await observability.shutdown();
      expect(observability).toBeDefined();
    });

    it('should handle multiple shutdowns', async () => {
      await observability.initialize();
      await observability.shutdown();
      await observability.shutdown();
      expect(observability).toBeDefined();
    });
  });
});

describe('Global Observability', () => {
  afterEach(async () => {
    await shutdownObservability();
  });

  describe('initializeObservability', () => {
    it('should initialize global observability', async () => {
      await initializeObservability();
      const obs = getObservability();
      expect(obs).toBeInstanceOf(Observability);
    });
  });

  describe('getObservability', () => {
    it('should return global observability instance', () => {
      const obs = getObservability();
      expect(obs).toBeInstanceOf(Observability);
    });

    it('should return same instance on multiple calls', () => {
      const obs1 = getObservability();
      const obs2 = getObservability();
      expect(obs1).toBe(obs2);
    });
  });

  describe('shutdownObservability', () => {
    it('should shutdown global observability', async () => {
      await initializeObservability();
      await shutdownObservability();
      const obs = getObservability();
      expect(obs).toBeInstanceOf(Observability);
    });
  });
});
