import type { CostTrackingConfig, SessionCost, TurnCost } from '../types/index.js';

interface TrackedTurn {
  sessionId: string;
  turnId: string;
  audioDurationMs: number;
  characterCount: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
}

export class CostTracker {
  private readonly config: CostTrackingConfig;
  private readonly turns: Map<string, Map<string, TrackedTurn>> = new Map();
  private readonly sessionStartTimes: Map<string, number> = new Map();

  constructor(config: CostTrackingConfig) {
    this.config = config;
  }

  startSession(sessionId: string): void {
    if (!this.config.enabled) {
      return;
    }

    this.turns.set(sessionId, new Map());
    this.sessionStartTimes.set(sessionId, Date.now());
  }

  trackSTTUsage(sessionId: string, turnId: string, audioDurationMs: number): void {
    if (!this.config.enabled) {
      return;
    }

    const turn = this.getOrCreateTurn(sessionId, turnId);
    turn.audioDurationMs = audioDurationMs;
  }

  trackTTSUsage(sessionId: string, turnId: string, characterCount: number): void {
    if (!this.config.enabled) {
      return;
    }

    const turn = this.getOrCreateTurn(sessionId, turnId);
    turn.characterCount = characterCount;
  }

  trackMCPUsage(
    sessionId: string,
    turnId: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const turn = this.getOrCreateTurn(sessionId, turnId);
    turn.inputTokens = inputTokens;
    turn.outputTokens = outputTokens;
  }

  setTurnProvider(sessionId: string, turnId: string, provider: string): void {
    if (!this.config.enabled) {
      return;
    }

    const turn = this.getOrCreateTurn(sessionId, turnId);
    turn.provider = provider;
  }

  getTurnCost(sessionId: string, turnId: string): TurnCost {
    const sessionTurns = this.turns.get(sessionId);
    const turn = sessionTurns?.get(turnId);
    if (!turn) {
      return {
        sttCost: 0,
        ttsCost: 0,
        mcpCost: 0,
        totalCost: 0,
        currency: this.config.currency,
      };
    }

    const pricing = this.config.providers[turn.provider] ?? this.config.providers.deepgram ?? {};
    let sttCost = 0;
    let ttsCost = 0;
    let mcpCost = 0;

    // STT cost
    if (pricing.stt) {
      if (pricing.stt.pricePerHour !== undefined) {
        sttCost = (turn.audioDurationMs / 3600000) * pricing.stt.pricePerHour;
      } else if (pricing.stt.pricePerMinute !== undefined) {
        sttCost = (turn.audioDurationMs / 60000) * pricing.stt.pricePerMinute;
      }
    } else if (pricing.llm) {
      sttCost = (turn.audioDurationMs / 60000) * 0.006;
    } else {
      sttCost = (turn.audioDurationMs / 60000) * 0.0059;
    }

    // TTS cost
    if (pricing.tts) {
      if (pricing.tts.pricePer1k !== undefined) {
        ttsCost = (turn.characterCount / 1000) * pricing.tts.pricePer1k;
      } else {
        ttsCost = turn.characterCount * pricing.tts.pricePerCharacter;
      }
    } else {
      ttsCost = turn.characterCount * 0.000015;
    }

    // MCP/LLM cost
    if (pricing.llm) {
      mcpCost =
        turn.inputTokens * pricing.llm.pricePerInputToken +
        turn.outputTokens * pricing.llm.pricePerOutputToken;
    }

    const totalCost = sttCost + ttsCost + mcpCost;

    return {
      sttCost,
      ttsCost,
      mcpCost,
      totalCost,
      currency: this.config.currency,
    };
  }

  getSessionCost(sessionId: string): SessionCost {
    const sessionTurns = this.turns.get(sessionId);
    const startTime = this.sessionStartTimes.get(sessionId) ?? 0;

    const turns: Array<{ turnId: string; cost: TurnCost }> = [];

    if (sessionTurns) {
      for (const [turnId] of sessionTurns) {
        turns.push({
          turnId,
          cost: this.getTurnCost(sessionId, turnId),
        });
      }
    }

    const totalCost = turns.reduce((sum, t) => sum + t.cost.totalCost, 0);

    return {
      sessionId,
      turns,
      totalCost,
      startTime,
      endTime: this.turns.has(sessionId) ? Date.now() : undefined,
    };
  }

  getAllCosts(): SessionCost[] {
    const sessions: SessionCost[] = [];
    for (const sessionId of this.turns.keys()) {
      sessions.push(this.getSessionCost(sessionId));
    }
    return sessions;
  }

  getTotalCost(): number {
    return this.getAllCosts().reduce((sum, s) => sum + s.totalCost, 0);
  }

  getAverageCostPerTurn(): number {
    let totalTurns = 0;
    let totalCost = 0;

    for (const sessionTurns of this.turns.values()) {
      totalTurns += sessionTurns.size;
    }

    if (totalTurns === 0) {
      return 0;
    }

    totalCost = this.getTotalCost();
    return totalCost / totalTurns;
  }

  getAverageCostPerMinute(): number {
    let totalDurationMs = 0;

    for (const [sessionId] of this.turns) {
      const sessionEntries = this.turns.get(sessionId);
      if (sessionEntries) {
        for (const turn of sessionEntries.values()) {
          totalDurationMs += turn.audioDurationMs;
        }
      }
    }

    if (totalDurationMs === 0) {
      return 0;
    }

    const totalMinutes = totalDurationMs / 60000;
    const totalCost = this.getTotalCost();
    return totalCost / totalMinutes;
  }

  endSession(sessionId: string): void {
    this.sessionStartTimes.delete(sessionId);
  }

  private getOrCreateTurn(sessionId: string, turnId: string): TrackedTurn {
    if (!this.turns.has(sessionId)) {
      this.turns.set(sessionId, new Map());
    }

    const sessionTurns = this.turns.get(sessionId) as Map<string, TrackedTurn>;

    if (!sessionTurns.has(turnId)) {
      const defaultProvider = Object.keys(this.config.providers)[0] ?? 'deepgram';
      sessionTurns.set(turnId, {
        sessionId,
        turnId,
        audioDurationMs: 0,
        characterCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        provider: defaultProvider,
      });
    }

    return sessionTurns.get(turnId) as TrackedTurn;
  }

  destroy(): void {
    this.turns.clear();
    this.sessionStartTimes.clear();
  }
}
