import { EventEmitter } from 'events';

/**
 * Options for configuring composite provider failover behavior.
 */
export interface CompositeProviderOptions {
  /** Provider names in priority order (primary first) */
  providers: string[];
  /** Consecutive failures before circuit breaker trips (default 3) */
  circuitBreakerThreshold?: number;
  /** Milliseconds before a tripped circuit breaker re-enables (default 30000) */
  circuitBreakerResetMs?: number;
  /** Milliseconds between periodic health checks (default 10000) */
  healthCheckIntervalMs?: number;
  /** Whether to automatically retry with the next provider on error (default true) */
  retryOnError?: boolean;
}

/**
 * Per-provider health status for monitoring and debugging.
 */
export interface ProviderHealth {
  provider: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  lastError?: { message: string; timestamp: number };
  lastSuccess?: { timestamp: number };
  /** Unix timestamp when the provider will become eligible again (circuit breaker) */
  disabledUntil?: number;
}

interface ProviderHealthInternal {
  provider: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  lastError?: { message: string; timestamp: number };
  lastSuccess?: { timestamp: number };
  disabledUntil?: number;
}

type RequiredOptions = Required<CompositeProviderOptions>;

/**
 * Standalone utility for managing provider failover logic, health tracking,
 * and circuit-breaking across a prioritized list of providers.
 *
 * @example
 * ```typescript
 * const fm = new FailoverManager({
 *   providers: ['deepgram', 'aws', 'google'],
 *   circuitBreakerThreshold: 3,
 * });
 *
 * fm.recordSuccess('deepgram');
 * fm.recordFailure('aws', new Error('timeout'));
 * const healthy = fm.getHealthyProviders();
 * const next = fm.getNextProvider('deepgram');
 * ```
 */
export interface FailoverManager {
  on(
    event: 'provider:unhealthy',
    listener: (data: { provider: string; error: string }) => void,
  ): this;
  on(event: 'provider:recovered', listener: (data: { provider: string }) => void): this;
  on(
    event: 'provider:failover',
    listener: (data: { from: string; to: string; error: string }) => void,
  ): this;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter events for failover
export class FailoverManager extends EventEmitter {
  private readonly healthMap: Map<string, ProviderHealthInternal>;
  private readonly options: RequiredOptions;
  private healthCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: CompositeProviderOptions) {
    super();
    this.options = {
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30000,
      healthCheckIntervalMs: 10000,
      retryOnError: true,
      ...options,
    } as RequiredOptions;

    this.healthMap = new Map();
    for (const provider of this.options.providers) {
      this.healthMap.set(provider, {
        provider,
        isHealthy: true,
        consecutiveFailures: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      });
    }
  }

  /**
   * Start periodically re-evaluating circuit breakers.
   * When a circuit breaker's reset timer expires, the provider is
   * marked healthy again and a `provider:recovered` event is emitted.
   */
  startPeriodicHealthCheck(): void {
    if (this.healthCheckTimer) {
      return;
    }
    this.healthCheckTimer = setInterval(() => {
      this.tickCircuitBreakers();
    }, this.options.healthCheckIntervalMs);
    this.healthCheckTimer.unref?.();
  }

  /**
   * Stop the periodic health check interval.
   */
  stopPeriodicHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Record a successful operation for the given provider.
   * Resets the consecutive failure counter and marks the provider as healthy.
   */
  recordSuccess(provider: string): void {
    const health = this.healthMap.get(provider);
    if (!health) {
      return;
    }
    health.consecutiveFailures = 0;
    health.totalSuccesses++;
    health.lastSuccess = { timestamp: Date.now() };

    if (!health.isHealthy) {
      health.isHealthy = true;
      health.disabledUntil = undefined;
      this.emit('provider:recovered', { provider });
    }
  }

  /**
   * Record a failed operation for the given provider.
   * Increments failure counters and may open the circuit breaker if the
   * threshold is exceeded, emitting `provider:unhealthy`.
   */
  recordFailure(provider: string, error?: Error | string): void {
    const health = this.healthMap.get(provider);
    if (!health) {
      return;
    }

    health.consecutiveFailures++;
    health.totalFailures++;
    health.lastError = {
      message: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      timestamp: Date.now(),
    };

    if (!health.isHealthy) {
      return;
    }

    if (health.consecutiveFailures >= this.options.circuitBreakerThreshold) {
      health.isHealthy = false;
      health.disabledUntil = Date.now() + this.options.circuitBreakerResetMs;
      this.emit('provider:unhealthy', {
        provider,
        error: health.lastError.message,
      });
    }
  }

  /**
   * Returns the list of provider names that are currently considered healthy
   * (not tripped by circuit breaker), in priority order.
   */
  getHealthyProviders(): string[] {
    return this.options.providers.filter((name) => {
      const health = this.healthMap.get(name);
      return health?.isHealthy ?? false;
    });
  }

  /**
   * Returns the next healthy provider in the chain after `current`.
   * Wraps around the provider list (round-robin). Returns `null` if no
   * healthy providers are available.
   */
  getNextProvider(current: string): string | null {
    const currentIndex = this.options.providers.indexOf(current);
    if (currentIndex === -1) {
      const healthy = this.getHealthyProviders();
      return healthy.length > 0 ? healthy[0] : null;
    }

    const healthySet = new Set(this.getHealthyProviders());

    for (let i = 1; i <= this.options.providers.length; i++) {
      const index = (currentIndex + i) % this.options.providers.length;
      const candidate = this.options.providers[index];
      if (healthySet.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Returns `true` if the circuit breaker is currently open for the given
   * provider (it has been disabled due to too many consecutive failures).
   */
  isCircuitOpen(provider: string): boolean {
    const health = this.healthMap.get(provider);
    if (!health) {
      return true;
    }
    if (!health.isHealthy && health.disabledUntil !== undefined) {
      return Date.now() < health.disabledUntil;
    }
    return false;
  }

  /**
   * Manually reset the circuit breaker for a provider, marking it healthy.
   * Emits `provider:recovered`.
   */
  resetCircuit(provider: string): void {
    const health = this.healthMap.get(provider);
    if (!health) {
      return;
    }
    health.isHealthy = true;
    health.consecutiveFailures = 0;
    health.disabledUntil = undefined;
    this.emit('provider:recovered', { provider });
  }

  /**
   * Returns a snapshot of health status for all tracked providers.
   */
  getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthMap.values()).map((h) => ({ ...h }));
  }

  /**
   * Returns a snapshot of health status for a single provider, or
   * `undefined` if the provider is not tracked.
   */
  getHealth(provider: string): ProviderHealth | undefined {
    const health = this.healthMap.get(provider);
    return health ? { ...health } : undefined;
  }

  /**
   * Clean up the failover manager: stop health checks, remove listeners,
   * and clear health data.
   */
  destroy(): void {
    this.stopPeriodicHealthCheck();
    this.removeAllListeners();
    this.healthMap.clear();
  }

  private tickCircuitBreakers(): void {
    const now = Date.now();
    for (const health of this.healthMap.values()) {
      if (!health.isHealthy && health.disabledUntil !== undefined && now >= health.disabledUntil) {
        health.isHealthy = true;
        health.consecutiveFailures = 0;
        health.disabledUntil = undefined;
        this.emit('provider:recovered', { provider: health.provider });
      }
    }
  }
}
