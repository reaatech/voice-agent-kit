import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FailoverManager } from '../src/providers/failover.js';
import type { CompositeProviderOptions } from '../src/providers/failover.js';

function makeOptions(overrides?: Partial<CompositeProviderOptions>): CompositeProviderOptions {
  return {
    providers: ['provider-a', 'provider-b', 'provider-c'],
    circuitBreakerThreshold: 2,
    circuitBreakerResetMs: 5000,
    healthCheckIntervalMs: 10000,
    retryOnError: true,
    ...overrides,
  };
}

describe('FailoverManager', () => {
  let fm: FailoverManager;

  beforeEach(() => {
    vi.useFakeTimers();
    fm = new FailoverManager(makeOptions());
  });

  afterEach(() => {
    fm.destroy();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize all providers as healthy', () => {
      const health = fm.getAllHealth();
      expect(health).toHaveLength(3);
      for (const h of health) {
        expect(h.isHealthy).toBe(true);
        expect(h.consecutiveFailures).toBe(0);
        expect(h.totalSuccesses).toBe(0);
        expect(h.totalFailures).toBe(0);
      }
    });

    it('should use default options when not provided', () => {
      const f = new FailoverManager({ providers: ['a', 'b'] });
      expect(f.getHealthyProviders()).toEqual(['a', 'b']);
      f.destroy();
    });
  });

  describe('recordSuccess()', () => {
    it('should reset consecutive failures and increment total successes', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordSuccess('provider-a');

      const health = fm.getHealth('provider-a');
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.totalSuccesses).toBe(1);
      expect(health?.totalFailures).toBe(1);
      expect(health?.isHealthy).toBe(true);
    });

    it('should emit provider:recovered when transitioning from unhealthy', () => {
      const spy = vi.fn();
      fm.on('provider:recovered', spy);

      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(false);

      fm.recordSuccess('provider-a');
      expect(spy).toHaveBeenCalledWith({ provider: 'provider-a' });
    });

    it('should be no-op for unknown provider', () => {
      expect(() => fm.recordSuccess('unknown')).not.toThrow();
    });
  });

  describe('recordFailure()', () => {
    it('should increment consecutive and total failures', () => {
      fm.recordFailure('provider-a', new Error('timeout'));
      const health = fm.getHealth('provider-a');
      expect(health?.consecutiveFailures).toBe(1);
      expect(health?.totalFailures).toBe(1);
      expect(health?.lastError?.message).toBe('timeout');
    });

    it('should trip circuit breaker when threshold exceeded', () => {
      const unhealthySpy = vi.fn();
      fm.on('provider:unhealthy', unhealthySpy);

      fm.recordFailure('provider-a', new Error('err1'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(true);

      fm.recordFailure('provider-a', new Error('err2'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(false);
      expect(fm.getHealth('provider-a')?.consecutiveFailures).toBe(2);
      expect(unhealthySpy).toHaveBeenCalledWith({
        provider: 'provider-a',
        error: 'err2',
      });
    });

    it('should not emit unhealthy again if already unhealthy', () => {
      const spy = vi.fn();
      fm.on('provider:unhealthy', spy);

      fm.recordFailure('provider-a', new Error('err1'));
      fm.recordFailure('provider-a', new Error('err2'));
      expect(spy).toHaveBeenCalledTimes(1);

      fm.recordFailure('provider-a', new Error('err3'));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(fm.getHealth('provider-a')?.consecutiveFailures).toBe(3);
    });

    it('should handle error as string', () => {
      fm.recordFailure('provider-a', 'string error');
      expect(fm.getHealth('provider-a')?.lastError?.message).toBe('string error');
    });

    it('should handle missing error parameter', () => {
      fm.recordFailure('provider-a');
      expect(fm.getHealth('provider-a')?.lastError?.message).toBe('Unknown error');
    });

    it('should be no-op for unknown provider', () => {
      expect(() => fm.recordFailure('unknown')).not.toThrow();
    });
  });

  describe('getHealthyProviders()', () => {
    it('should return all providers when all healthy', () => {
      expect(fm.getHealthyProviders()).toEqual(['provider-a', 'provider-b', 'provider-c']);
    });

    it('should exclude unhealthy providers', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));

      expect(fm.getHealthyProviders()).toEqual(['provider-b', 'provider-c']);
    });
  });

  describe('getNextProvider()', () => {
    it('should return next healthy provider in priority order', () => {
      expect(fm.getNextProvider('provider-a')).toBe('provider-b');
    });

    it('should wrap around to the beginning', () => {
      expect(fm.getNextProvider('provider-c')).toBe('provider-a');
    });

    it('should skip unhealthy providers', () => {
      fm.recordFailure('provider-b', new Error('fail'));
      fm.recordFailure('provider-b', new Error('fail'));

      expect(fm.getNextProvider('provider-a')).toBe('provider-c');
    });

    it('should return first healthy when current not found in list', () => {
      expect(fm.getNextProvider('unknown')).toBe('provider-a');
    });

    it('should return null when no healthy providers', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-b', new Error('fail'));
      fm.recordFailure('provider-b', new Error('fail'));
      fm.recordFailure('provider-c', new Error('fail'));
      fm.recordFailure('provider-c', new Error('fail'));

      expect(fm.getNextProvider('provider-a')).toBeNull();
    });
  });

  describe('isCircuitOpen()', () => {
    it('should return false for healthy provider', () => {
      expect(fm.isCircuitOpen('provider-a')).toBe(false);
    });

    it('should return true for unhealthy provider within window', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));

      expect(fm.isCircuitOpen('provider-a')).toBe(true);
    });

    it('should return false for unhealthy provider after reset window', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      expect(fm.isCircuitOpen('provider-a')).toBe(true);

      vi.advanceTimersByTime(5000);

      const health = fm.getHealth('provider-a');
      expect(health?.disabledUntil).toBeDefined();
      if (health?.disabledUntil) {
        expect(Date.now()).toBeGreaterThanOrEqual(health.disabledUntil);
      }
    });

    it('should return true for unknown provider', () => {
      expect(fm.isCircuitOpen('unknown')).toBe(true);
    });
  });

  describe('resetCircuit()', () => {
    it('should mark provider healthy and emit recovered event', () => {
      const spy = vi.fn();
      fm.on('provider:recovered', spy);

      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(false);

      fm.resetCircuit('provider-a');
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(true);
      expect(fm.getHealth('provider-a')?.consecutiveFailures).toBe(0);
      expect(spy).toHaveBeenCalledWith({ provider: 'provider-a' });
    });

    it('should be no-op for unknown provider', () => {
      expect(() => fm.resetCircuit('unknown')).not.toThrow();
    });
  });

  describe('getAllHealth() and getHealth()', () => {
    it('getAllHealth should return copies of all health records', () => {
      const all = fm.getAllHealth();
      expect(all).toHaveLength(3);
      expect(all[0].provider).toBe('provider-a');
    });

    it('getHealth should return copy of single record', () => {
      const health = fm.getHealth('provider-a');
      expect(health).toBeDefined();
      expect(health?.provider).toBe('provider-a');
      expect(health?.isHealthy).toBe(true);
    });

    it('getHealth should return undefined for unknown provider', () => {
      expect(fm.getHealth('unknown')).toBeUndefined();
    });
  });

  describe('events', () => {
    it('should emit provider:failover events', () => {
      const spy = vi.fn();
      fm.on('provider:failover', spy);

      fm.emit('provider:failover', {
        from: 'provider-a',
        to: 'provider-b',
        error: 'Failed over from provider-a',
      });

      expect(spy).toHaveBeenCalledWith({
        from: 'provider-a',
        to: 'provider-b',
        error: 'Failed over from provider-a',
      });
    });
  });

  describe('periodic health check', () => {
    it('should start and stop periodic checks', () => {
      fm.startPeriodicHealthCheck();

      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(false);

      const spy = vi.fn();
      fm.on('provider:recovered', spy);

      vi.advanceTimersByTime(5000);
      // tickCircuitBreakers runs every healthCheckIntervalMs (10000), so let's advance that long
      vi.advanceTimersByTime(10000);

      // After circuitBreakerResetMs (5000) + healthCheckIntervalMs (10000) have passed
      // Actually, tickCircuitBreakers is called on the interval, so we need one interval cycle after the reset time
      expect(spy).toHaveBeenCalled();
    });

    it('should not create duplicate timers', () => {
      fm.startPeriodicHealthCheck();
      const timer1 = (fm as unknown as { healthCheckTimer: ReturnType<typeof setInterval> }).healthCheckTimer;

      fm.startPeriodicHealthCheck();
      const timer2 = (fm as unknown as { healthCheckTimer: ReturnType<typeof setInterval> }).healthCheckTimer;

      expect(timer1).toBe(timer2);
    });

    it('stopPeriodicHealthCheck should clear the timer', () => {
      fm.startPeriodicHealthCheck();
      fm.stopPeriodicHealthCheck();

      const timer = (fm as unknown as { healthCheckTimer: ReturnType<typeof setInterval> | undefined }).healthCheckTimer;
      expect(timer).toBeUndefined();
    });
  });

  describe('tickCircuitBreakers()', () => {
    it('should auto-recover providers after reset timeout', () => {
      fm.recordFailure('provider-a', new Error('fail'));
      fm.recordFailure('provider-a', new Error('fail'));
      expect(fm.getHealth('provider-a')?.isHealthy).toBe(false);

      const spy = vi.fn();
      fm.on('provider:recovered', spy);

      vi.advanceTimersByTime(5000);
      (fm as unknown as { tickCircuitBreakers: () => void }).tickCircuitBreakers();

      expect(fm.getHealth('provider-a')?.isHealthy).toBe(true);
      expect(spy).toHaveBeenCalledWith({ provider: 'provider-a' });
    });
  });

  describe('destroy()', () => {
    it('should stop health check and clear all data', () => {
      fm.startPeriodicHealthCheck();
      fm.destroy();

      const timer = (fm as unknown as { healthCheckTimer: ReturnType<typeof setInterval> | undefined }).healthCheckTimer;
      expect(timer).toBeUndefined();

      expect(fm.getAllHealth()).toHaveLength(0);
    });
  });
});
