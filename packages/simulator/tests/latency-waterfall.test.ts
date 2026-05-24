import { describe, expect, it } from 'vitest';

import type { LatencyWaterfallRow } from '../src/latency-waterfall.js';
import { renderLatencyWaterfall } from '../src/latency-waterfall.js';

// Strip ANSI color codes so assertions are stable regardless of chalk's
// TTY/FORCE_COLOR detection.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function row(overrides: Partial<LatencyWaterfallRow> = {}): LatencyWaterfallRow {
  return {
    turn: 1,
    userSaid: 'hello there',
    agentSaid: 'hi, how can I help',
    sttMs: 100,
    mcpMs: 200,
    ttsFirstByteMs: 150,
    totalMs: 450,
    sttBudget: 200,
    mcpBudget: 400,
    ttsBudget: 300,
    totalBudgetTarget: 800,
    totalBudgetHardCap: 1500,
    ...overrides,
  };
}

describe('renderLatencyWaterfall', () => {
  it('returns a placeholder when there are no rows', () => {
    expect(stripAnsi(renderLatencyWaterfall([]))).toContain('No turns recorded.');
  });

  it('renders a header and the per-turn latencies', () => {
    const out = stripAnsi(renderLatencyWaterfall([row()]));

    expect(out).toContain('User Said');
    expect(out).toContain('Agent Said');
    expect(out).toContain('100ms');
    expect(out).toContain('200ms');
    expect(out).toContain('150ms');
    expect(out).toContain('450ms');
  });

  it('appends an average row across multiple turns', () => {
    const out = stripAnsi(
      renderLatencyWaterfall([row({ turn: 1, sttMs: 100 }), row({ turn: 2, sttMs: 300 })]),
    );

    expect(out).toContain('AVG');
    // (100 + 300) / 2 = 200
    expect(out).toContain('200ms');
  });

  it('renders a row per turn', () => {
    const out = stripAnsi(
      renderLatencyWaterfall([
        row({ turn: 1, userSaid: 'first' }),
        row({ turn: 2, userSaid: 'second' }),
        row({ turn: 3, userSaid: 'third' }),
      ]),
    );

    for (const text of ['first', 'second', 'third']) {
      expect(out).toContain(text);
    }
  });
});
