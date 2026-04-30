import { EventEmitter } from 'node:events';

import type { LatencyBudget } from '../types/index.js';

export interface LatencyMetrics {
  sttLatencyMs: number;
  mcpLatencyMs: number;
  ttsFirstByteMs: number;
  totalTurnLatencyMs: number;
  budgetExceeded: boolean;
  exceededStages: string[];
}

export interface StageTiming {
  stage: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export class LatencyBudgetEnforcer extends EventEmitter {
  private readonly budget: LatencyBudget;
  private readonly turnTimings: Map<string, Map<string, StageTiming>> = new Map();
  private readonly turnStartTimes: Map<string, number> = new Map();

  constructor(budget: LatencyBudget) {
    super();
    this.budget = budget;
  }

  startTurn(turnId: string): void {
    this.turnStartTimes.set(turnId, performance.now());
    this.turnTimings.set(turnId, new Map());
  }

  startStage(turnId: string, stage: string): void {
    const turnTimings = this.turnTimings.get(turnId);

    if (!turnTimings) {
      this.emit('warning', { turnId, message: `No turn timing found for turn ${turnId}` });
      return;
    }

    turnTimings.set(stage, {
      stage,
      startTime: performance.now(),
    });
  }

  endStage(turnId: string, stage: string): number {
    const turnTimings = this.turnTimings.get(turnId);

    if (!turnTimings) {
      return 0;
    }

    const timing = turnTimings.get(stage);

    if (!timing) {
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - timing.startTime;

    timing.endTime = endTime;
    timing.duration = duration;

    return duration;
  }

  endTurn(turnId: string): LatencyMetrics {
    const turnStartTime = this.turnStartTimes.get(turnId);
    const turnTimings = this.turnTimings.get(turnId);

    if (!turnStartTime || !turnTimings) {
      return this.createEmptyMetrics();
    }

    const sttTiming = turnTimings.get('stt');
    const mcpTiming = turnTimings.get('mcp');
    const ttsTiming = turnTimings.get('tts');

    const sttLatencyMs = sttTiming?.duration ?? 0;
    const mcpLatencyMs = mcpTiming?.duration ?? 0;
    const ttsFirstByteMs = ttsTiming?.duration ?? 0;
    const totalTurnLatencyMs = performance.now() - turnStartTime;

    const exceededStages: string[] = [];

    if (sttLatencyMs > this.budget.stages.stt) {
      exceededStages.push('stt');
    }

    if (mcpLatencyMs > this.budget.stages.mcp) {
      exceededStages.push('mcp');
    }

    if (ttsFirstByteMs > this.budget.stages.tts) {
      exceededStages.push('tts');
    }

    const budgetExceeded =
      exceededStages.length > 0 || totalTurnLatencyMs > this.budget.total.hardCap;

    // Clean up
    this.turnTimings.delete(turnId);
    this.turnStartTimes.delete(turnId);

    const metrics: LatencyMetrics = {
      sttLatencyMs,
      mcpLatencyMs,
      ttsFirstByteMs,
      totalTurnLatencyMs,
      budgetExceeded,
      exceededStages,
    };

    if (budgetExceeded) {
      this.emit('budget:exceeded', { turnId, metrics, budget: this.budget });
    }

    this.emit('turn:complete', { turnId, metrics });

    return metrics;
  }

  getStageBudget(stage: 'stt' | 'mcp' | 'tts'): number {
    return this.budget.stages[stage];
  }

  getTotalTargetBudget(): number {
    return this.budget.total.target;
  }

  getTotalHardCap(): number {
    return this.budget.total.hardCap;
  }

  checkStageBudget(
    stage: 'stt' | 'mcp' | 'tts',
    elapsedMs: number,
  ): {
    withinBudget: boolean;
    remainingMs: number;
    exceeded: boolean;
  } {
    const budget = this.budget.stages[stage];
    const remaining = budget - elapsedMs;

    return {
      withinBudget: remaining >= 0,
      remainingMs: Math.max(0, remaining),
      exceeded: remaining < 0,
    };
  }

  checkTotalBudget(elapsedMs: number): {
    withinTarget: boolean;
    withinHardCap: boolean;
    remainingTargetMs: number;
    remainingHardCapMs: number;
  } {
    const targetRemaining = this.budget.total.target - elapsedMs;
    const hardCapRemaining = this.budget.total.hardCap - elapsedMs;

    return {
      withinTarget: targetRemaining >= 0,
      withinHardCap: hardCapRemaining >= 0,
      remainingTargetMs: Math.max(0, targetRemaining),
      remainingHardCapMs: Math.max(0, hardCapRemaining),
    };
  }

  private createEmptyMetrics(): LatencyMetrics {
    return {
      sttLatencyMs: 0,
      mcpLatencyMs: 0,
      ttsFirstByteMs: 0,
      totalTurnLatencyMs: 0,
      budgetExceeded: false,
      exceededStages: [],
    };
  }

  destroy(): void {
    this.turnTimings.clear();
    this.turnStartTimes.clear();
    this.removeAllListeners();
  }
}

// Utility function to create a latency budget from config
export function createLatencyBudget(config: {
  target?: number;
  hardCap?: number;
  stt?: number;
  mcp?: number;
  tts?: number;
}): LatencyBudget {
  return {
    total: {
      target: config.target ?? 800,
      hardCap: config.hardCap ?? 1200,
    },
    stages: {
      stt: config.stt ?? 200,
      mcp: config.mcp ?? 400,
      tts: config.tts ?? 200,
    },
  };
}

// Performance monitoring helper
export class PerformanceMonitor {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs);

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getStats(): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  } {
    if (this.samples.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      avg: sum / sorted.length,
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  reset(): void {
    this.samples.length = 0;
  }
}
