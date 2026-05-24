import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CostTracker, DEFAULT_PRICING } from '../src/cost/index.js';
import type { CostTrackingConfig } from '../src/types/index.js';

function createConfig(overrides: Partial<CostTrackingConfig> = {}): CostTrackingConfig {
  return {
    enabled: true,
    currency: 'USD',
    providers: {
      deepgram: {
        stt: { pricePerMinute: 0.0059 },
        tts: { pricePerCharacter: 0.000015 },
      },
      openai: {
        stt: { pricePerMinute: 0.006 },
        llm: { pricePerInputToken: 0.0000025, pricePerOutputToken: 0.00001 },
        tts: { pricePerCharacter: 0.000015 },
      },
      assemblyai: {
        stt: { pricePerHour: 0.47 },
      },
    },
    ...overrides,
  };
}

describe('CostTracker', () => {
  let tracker: CostTracker;
  let config: CostTrackingConfig;

  beforeEach(() => {
    config = createConfig();
    tracker = new CostTracker(config);
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('constructor', () => {
    it('should create a cost tracker instance', () => {
      expect(tracker).toBeInstanceOf(CostTracker);
    });
  });

  describe('startSession', () => {
    it('should initialize a session for tracking', () => {
      tracker.startSession('session-1');

      const cost = tracker.getSessionCost('session-1');
      expect(cost.sessionId).toBe('session-1');
      expect(cost.turns).toEqual([]);
      expect(cost.totalCost).toBe(0);
    });

    it('should not start session when disabled', () => {
      const disabled = new CostTracker(createConfig({ enabled: false }));
      disabled.startSession('session-1');

      const cost = disabled.getSessionCost('session-1');
      expect(cost.turns).toEqual([]);
      disabled.destroy();
    });
  });

  describe('trackSTTUsage', () => {
    it('should track audio duration for STT', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.0059, 6);
    });

    it('should calculate STT cost with pricePerHour', () => {
      tracker.startSession('session-1');
      tracker.setTurnProvider('session-1', 'turn-1', 'assemblyai');
      tracker.trackSTTUsage('session-1', 'turn-1', 3600000);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.47, 6);
    });

    it('should use default STT pricing when no provider pricing', () => {
      const defaultConfig = createConfig({ providers: {} });
      const defaultTracker = new CostTracker(defaultConfig);
      defaultTracker.startSession('session-1');
      defaultTracker.trackSTTUsage('session-1', 'turn-1', 60000);

      const cost = defaultTracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.0059, 6);

      defaultTracker.destroy();
    });

    it('should not track when disabled', () => {
      const disabled = new CostTracker(createConfig({ enabled: false }));
      disabled.startSession('session-1');
      disabled.trackSTTUsage('session-1', 'turn-1', 60000);

      const cost = disabled.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBe(0);
      expect(cost.totalCost).toBe(0);
      disabled.destroy();
    });
  });

  describe('trackTTSUsage', () => {
    it('should track character count for TTS', () => {
      tracker.startSession('session-1');
      tracker.trackTTSUsage('session-1', 'turn-1', 1000);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.ttsCost).toBeCloseTo(0.015, 6);
    });

    it('should calculate TTS cost with pricePer1k', () => {
      const configWithPricePer1k: CostTrackingConfig = {
        enabled: true,
        currency: 'USD',
        providers: {
          test: {
            tts: { pricePerCharacter: 0, pricePer1k: 0.03 },
          },
        },
      };
      const p1kTracker = new CostTracker(configWithPricePer1k);
      p1kTracker.startSession('session-1');
      p1kTracker.setTurnProvider('session-1', 'turn-1', 'test');
      p1kTracker.trackTTSUsage('session-1', 'turn-1', 2000);

      const cost = p1kTracker.getTurnCost('session-1', 'turn-1');
      expect(cost.ttsCost).toBeCloseTo(0.06, 6);

      p1kTracker.destroy();
    });

    it('should use default TTS pricing when no provider pricing', () => {
      const defaultConfig = createConfig({ providers: {} });
      const defaultTracker = new CostTracker(defaultConfig);
      defaultTracker.startSession('session-1');
      defaultTracker.trackTTSUsage('session-1', 'turn-1', 500);

      const cost = defaultTracker.getTurnCost('session-1', 'turn-1');
      expect(cost.ttsCost).toBeCloseTo(500 * 0.000015, 6);

      defaultTracker.destroy();
    });
  });

  describe('trackMCPUsage', () => {
    it('should track token counts for MCP', () => {
      tracker.startSession('session-1');
      tracker.setTurnProvider('session-1', 'turn-1', 'openai');
      tracker.trackMCPUsage('session-1', 'turn-1', 1000, 200);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      const expectedInput = 1000 * 0.0000025;
      const expectedOutput = 200 * 0.00001;
      expect(cost.mcpCost).toBeCloseTo(expectedInput + expectedOutput, 10);
    });

    it('should return 0 MCP cost when no llm pricing', () => {
      tracker.startSession('session-1');
      tracker.trackMCPUsage('session-1', 'turn-1', 1000, 200);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.mcpCost).toBe(0);
    });
  });

  describe('setTurnProvider', () => {
    it('should set provider for a turn', () => {
      tracker.startSession('session-1');
      tracker.setTurnProvider('session-1', 'turn-1', 'assemblyai');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.47 / 60, 6);
    });

    it('should default to first provider key', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.0059, 6);
    });
  });

  describe('getTurnCost', () => {
    it('should return zero costs for non-existent turn', () => {
      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBe(0);
      expect(cost.ttsCost).toBe(0);
      expect(cost.mcpCost).toBe(0);
      expect(cost.totalCost).toBe(0);
      expect(cost.currency).toBe('USD');
    });

    it('should calculate combined cost for a turn', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);
      tracker.trackTTSUsage('session-1', 'turn-1', 500);
      tracker.setTurnProvider('session-1', 'turn-1', 'openai');
      tracker.trackMCPUsage('session-1', 'turn-1', 1000, 200);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.006, 6);
      expect(cost.ttsCost).toBeCloseTo(0.0075, 6);
      expect(cost.mcpCost).toBeCloseTo(0.0045, 10);
      expect(cost.totalCost).toBeCloseTo(0.018, 6);
      expect(cost.currency).toBe('USD');
    });

    it('should return zero costs for zero duration and characters', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 0);
      tracker.trackTTSUsage('session-1', 'turn-1', 0);
      tracker.trackMCPUsage('session-1', 'turn-1', 0, 0);

      const cost = tracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBe(0);
      expect(cost.ttsCost).toBe(0);
      expect(cost.mcpCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });
  });

  describe('getSessionCost', () => {
    it('should aggregate costs across turns', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);
      tracker.trackTTSUsage('session-1', 'turn-1', 500);
      tracker.trackSTTUsage('session-1', 'turn-2', 120000);
      tracker.trackTTSUsage('session-1', 'turn-2', 200);

      const sessionCost = tracker.getSessionCost('session-1');
      expect(sessionCost.turns).toHaveLength(2);
      expect(sessionCost.totalCost).toBeGreaterThan(0);
      expect(sessionCost.startTime).toBeGreaterThan(0);
      expect(sessionCost.endTime).toBeDefined();
    });

    it('should return empty session for non-existent session', () => {
      const sessionCost = tracker.getSessionCost('non-existent');
      expect(sessionCost.turns).toEqual([]);
      expect(sessionCost.totalCost).toBe(0);
    });
  });

  describe('getTotalCost', () => {
    it('should sum costs across all sessions', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);
      tracker.trackTTSUsage('session-1', 'turn-1', 500);

      tracker.startSession('session-2');
      tracker.trackSTTUsage('session-2', 'turn-1', 120000);
      tracker.trackTTSUsage('session-2', 'turn-1', 200);

      const total = tracker.getTotalCost();
      expect(total).toBeGreaterThan(0);
    });

    it('should return 0 when no sessions tracked', () => {
      expect(tracker.getTotalCost()).toBe(0);
    });
  });

  describe('getAverageCostPerTurn', () => {
    it('should calculate average cost across all turns', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);
      tracker.trackSTTUsage('session-1', 'turn-2', 60000);

      const average = tracker.getAverageCostPerTurn();
      expect(average).toBeGreaterThan(0);
    });

    it('should return 0 when no turns exist', () => {
      expect(tracker.getAverageCostPerTurn()).toBe(0);
    });
  });

  describe('getAverageCostPerMinute', () => {
    it('should calculate average cost per minute', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 120000);

      const average = tracker.getAverageCostPerMinute();
      expect(average).toBeCloseTo(0.0059, 6);
    });

    it('should return 0 when no duration exists', () => {
      expect(tracker.getAverageCostPerMinute()).toBe(0);
    });
  });

  describe('getAllCosts', () => {
    it('should return costs for all sessions', () => {
      tracker.startSession('session-1');
      tracker.startSession('session-2');

      const all = tracker.getAllCosts();
      expect(all).toHaveLength(2);
    });
  });

  describe('endSession', () => {
    it('should clean up session start time', () => {
      tracker.startSession('session-1');
      tracker.endSession('session-1');

      const cost = tracker.getSessionCost('session-1');
      expect(cost.turns).toEqual([]);
    });
  });

  describe('unknown provider', () => {
    it('should fall back to deepgram pricing for unrecognized provider', () => {
      const newTracker = new CostTracker({
        enabled: true,
        currency: 'USD',
        providers: {
          deepgram: {
            stt: { pricePerMinute: 0.0059 },
            tts: { pricePerCharacter: 0.000015 },
          },
        },
      });
      newTracker.startSession('session-1');
      newTracker.setTurnProvider('session-1', 'turn-1', 'unknown');
      newTracker.trackSTTUsage('session-1', 'turn-1', 60000);
      newTracker.trackTTSUsage('session-1', 'turn-1', 1000);

      const cost = newTracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.0059, 6);
      expect(cost.ttsCost).toBeCloseTo(0.015, 6);
      expect(cost.mcpCost).toBe(0);

      newTracker.destroy();
    });

    it('should use hardcoded defaults when no provider pricing exists', () => {
      const emptyConfig: CostTrackingConfig = {
        enabled: true,
        currency: 'USD',
        providers: {},
      };
      const emptyTracker = new CostTracker(emptyConfig);
      emptyTracker.startSession('session-1');
      emptyTracker.setTurnProvider('session-1', 'turn-1', 'non-existent');
      emptyTracker.trackSTTUsage('session-1', 'turn-1', 60000);
      emptyTracker.trackTTSUsage('session-1', 'turn-1', 1000);

      const cost = emptyTracker.getTurnCost('session-1', 'turn-1');
      expect(cost.sttCost).toBeCloseTo(0.0059, 6);
      expect(cost.ttsCost).toBeCloseTo(0.015, 6);
      expect(cost.mcpCost).toBe(0);

      emptyTracker.destroy();
    });
  });

  describe('DEFAULT_PRICING', () => {
    it('should define Deepgram pricing', () => {
      const deepgram = DEFAULT_PRICING.deepgram;
      expect(deepgram.stt?.pricePerMinute).toBe(0.0059);
      expect(deepgram.tts?.pricePerCharacter).toBe(0.000015);
    });

    it('should define OpenAI pricing', () => {
      const openai = DEFAULT_PRICING.openai;
      expect(openai.stt?.pricePerMinute).toBe(0.006);
      expect(openai.llm?.pricePerInputToken).toBe(0.0000025);
      expect(openai.llm?.pricePerOutputToken).toBe(0.00001);
      expect(openai.tts?.pricePerCharacter).toBe(0.000015);
    });

    it('should define ElevenLabs pricing', () => {
      const elevenlabs = DEFAULT_PRICING.elevenlabs;
      expect(elevenlabs.tts?.pricePerCharacter).toBe(0.000015);
    });

    it('should define Cartesia pricing', () => {
      const cartesia = DEFAULT_PRICING.cartesia;
      expect(cartesia.tts?.pricePerCharacter).toBe(0.000005);
    });

    it('should define AssemblyAI pricing', () => {
      const assemblyai = DEFAULT_PRICING.assemblyai;
      expect(assemblyai.stt?.pricePerHour).toBe(0.47);
    });

    it('should define AWS pricing', () => {
      const aws = DEFAULT_PRICING.aws;
      expect(aws.stt?.pricePerMinute).toBe(0.024);
      expect(aws.tts?.pricePerCharacter).toBe(0.000004);
    });

    it('should define Google pricing', () => {
      const google = DEFAULT_PRICING.google;
      expect(google.stt?.pricePerMinute).toBe(0.016);
      expect(google.tts?.pricePerCharacter).toBe(0.000016);
    });

    it('should define Azure pricing', () => {
      const azure = DEFAULT_PRICING.azure;
      expect(azure.stt?.pricePerHour).toBe(1.0);
      expect(azure.tts?.pricePerCharacter).toBe(0.000015);
    });

    it('should define Groq pricing', () => {
      const groq = DEFAULT_PRICING.groq;
      expect(groq.stt?.pricePerHour).toBe(0.03);
    });
  });

  describe('destroy', () => {
    it('should clear all tracked data', () => {
      tracker.startSession('session-1');
      tracker.trackSTTUsage('session-1', 'turn-1', 60000);

      tracker.destroy();

      expect(tracker.getTotalCost()).toBe(0);
      expect(tracker.getAllCosts()).toHaveLength(0);
    });
  });
});
