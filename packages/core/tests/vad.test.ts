import { describe, expect, it, vi } from 'vitest';
import type { AudioChunk } from '../src/types/index.js';
import { EnergyVADProvider } from '../src/vad/energy-vad.js';
import { createDefaultVADProvider, createVADProvider } from '../src/vad/index.js';
import {
  createSemanticEndpointDetector,
  SemanticEndpointDetector,
} from '../src/vad/semantic-endpoint.js';

function silenceChunk(timestamp: number, sampleRate = 8000): AudioChunk {
  const frameSamples = Math.floor((sampleRate / 1000) * 20);
  return {
    buffer: Buffer.alloc(frameSamples, 128),
    sampleRate,
    encoding: 'mulaw',
    channels: 1,
    timestamp,
  };
}

function speechChunk(timestamp: number, sampleRate = 8000, amp = 200): AudioChunk {
  const frameSamples = Math.floor((sampleRate / 1000) * 20);
  const buf = Buffer.alloc(frameSamples);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = i % 2 === 0 ? amp : 256 - amp;
  }
  return {
    buffer: buf,
    sampleRate,
    encoding: 'mulaw',
    channels: 1,
    timestamp,
  };
}

function initNoiseFloor(vad: EnergyVADProvider): void {
  for (let i = 0; i < 15; i++) {
    vad.process(silenceChunk(10_000 + i * 20));
  }
}

describe('EnergyVADProvider', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const v = new EnergyVADProvider();
      expect(v.name).toBe('energy-vad');
      expect(v.sampleRate).toBe(8000);
    });

    it('should create with custom config', () => {
      const v = new EnergyVADProvider({
        sampleRate: 16000,
        speechThreshold: 3.0,
        silenceTimeout: 1000,
        minSpeechDuration: 500,
        maxSpeechDuration: 8000,
        noiseFloorWindow: 5000,
        smoothingFactor: 0.8,
      });
      expect(v.sampleRate).toBe(16000);
    });
  });

  describe('process()', () => {
    it('should return VADResult with correct shape', () => {
      const vad = new EnergyVADProvider();
      const result = vad.process(silenceChunk(1234));
      expect(result).toHaveProperty('isSpeech');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('timestamp', 1234);
      expect(result).toHaveProperty('audioLevel');
      expect(typeof result.isSpeech).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.audioLevel).toBe('number');
    });

    it('should detect speech when audio level is above threshold', () => {
      const vad = new EnergyVADProvider();
      initNoiseFloor(vad);

      const result = vad.process(speechChunk(10_500));
      expect(result.isSpeech).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should transition from speech to silence as smoothed RMS decays', () => {
      const vad = new EnergyVADProvider({ smoothingFactor: 0.1, speechThreshold: 2.0 });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));

      const r1 = vad.process(silenceChunk(10_520));
      expect(r1.isSpeech).toBe(true);

      const r2 = vad.process(silenceChunk(10_540));
      expect(r2.isSpeech).toBe(true);

      const r3 = vad.process(silenceChunk(10_560));
      expect(r3.isSpeech).toBe(false);
    });

    it('should return isSpeech=false before noise floor initialized', () => {
      const vad = new EnergyVADProvider();
      const result = vad.process(speechChunk(500));
      expect(result.isSpeech).toBe(false);
    });

    it('should handle empty buffer without crashing', () => {
      const vad = new EnergyVADProvider();
      const chunk: AudioChunk = {
        buffer: Buffer.alloc(0),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };
      const result = vad.process(chunk);
      expect(result.isSpeech).toBe(false);
    });

    it('should handle very short buffer without crashing', () => {
      const vad = new EnergyVADProvider();
      const chunk: AudioChunk = {
        buffer: Buffer.from([128]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };
      const result = vad.process(chunk);
      expect(typeof result.isSpeech).toBe('boolean');
    });

    it('should handle buffer larger than frame size via subsampling', () => {
      const vad = new EnergyVADProvider();
      initNoiseFloor(vad);

      const buf = Buffer.alloc(480);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = i % 2 === 0 ? 200 : 56;
      }
      const chunk: AudioChunk = {
        buffer: buf,
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: 10_500,
      };
      const result = vad.process(chunk);
      expect(result.isSpeech).toBe(true);
    });

    it('should apply smoothing across consecutive frames', () => {
      const vad = new EnergyVADProvider();
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));
      const r1 = vad.process(speechChunk(10_520));
      expect(r1.isSpeech).toBe(true);

      const r2 = vad.process(speechChunk(10_540));
      expect(r2.isSpeech).toBe(true);
    });
  });

  describe('adaptive noise floor', () => {
    it('should initialize and adapt noise floor', () => {
      const vad = new EnergyVADProvider();
      initNoiseFloor(vad);

      const floorBefore = (vad as unknown as { noiseFloorRms: number }).noiseFloorRms;
      expect(floorBefore).toBeGreaterThanOrEqual(0.1);

      for (let i = 0; i < 20; i++) {
        vad.process(silenceChunk(12_000 + i * 20));
      }

      const floorAfter = (vad as unknown as { noiseFloorRms: number }).noiseFloorRms;
      expect(floorAfter).toBeGreaterThanOrEqual(0.1);
    });

    it('should clamp noise floor to minimum of 0.1', () => {
      const vad = new EnergyVADProvider();
      for (let i = 0; i < 15; i++) {
        vad.process(silenceChunk(100 + i * 20));
      }
      const floor = (vad as unknown as { noiseFloorRms: number }).noiseFloorRms;
      expect(floor).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('checkEndpoint()', () => {
    it('should return not endpoint with empty history', () => {
      const vad = new EnergyVADProvider();
      const result = vad.checkEndpoint([]);
      expect(result.isEndpoint).toBe(false);
      expect(result.reason).toBe('silence');
      expect(result.confidence).toBe(1.0);
    });

    it('should detect max_duration endpoint using passed history timestamps', () => {
      const vad = new EnergyVADProvider({ maxSpeechDuration: 200, silenceTimeout: 5000 });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));

      const result = vad.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_900, audioLevel: 0.8 },
      ]);
      // isSpeaking=true, now=10900, speakingStartedAt=10500
      // total=400 >= 200 → max_duration
      expect(result.isEndpoint).toBe(true);
      expect(result.reason).toBe('max_duration');
      expect(result.totalSpeechDurationMs).toBe(400);
      expect(result.confidence).toBe(1.0);
    });

    it('should detect silence endpoint using passed history timestamps', () => {
      const vad = new EnergyVADProvider({
        silenceTimeout: 200,
        minSpeechDuration: 50,
        maxSpeechDuration: 50000,
      });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));

      const result = vad.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: false, confidence: 0, timestamp: 10_800, audioLevel: 0 },
      ]);
      // isSpeaking=true, now=10800, lastSpeechTimestamp=10500
      // silence=300 >= 200, total=300 >= 50 → silence endpoint
      expect(result.isEndpoint).toBe(true);
      expect(result.reason).toBe('silence');
      expect(result.silenceDurationMs).toBe(300);
      expect(result.totalSpeechDurationMs).toBe(300);
    });

    it('should not detect endpoint when speech is below minSpeechDuration', () => {
      const vad = new EnergyVADProvider({
        silenceTimeout: 100,
        minSpeechDuration: 500,
        maxSpeechDuration: 50000,
      });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));

      const result = vad.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: false, confidence: 0, timestamp: 10_700, audioLevel: 0 },
      ]);
      // isSpeaking=true, now=10700, lastSpeech=10500, silence=200>=100
      // totalSpeech=200 < 500 → not endpoint, confidence=0.5
      expect(result.isEndpoint).toBe(false);
      expect(result.confidence).toBe(0.5);
    });

    it('should increase endpoint confidence when totalSpeechDurationMs exceeds 500', () => {
      const vad = new EnergyVADProvider({
        silenceTimeout: 100,
        minSpeechDuration: 50,
        maxSpeechDuration: 50000,
      });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));

      const result = vad.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: false, confidence: 0, timestamp: 10_800, audioLevel: 0 },
      ]);
      // isSpeaking=true, now=10800, lastSpeech=10500, silence=300>=100
      // totalSpeech=300, ratio=300/100=3.0≥2.0, confidence=0.6+0.3=0.9, total<500 no bonus
      expect(result.isEndpoint).toBe(true);
      expect(result.reason).toBe('silence');

      // Now with totalSpeechDurationMs > 500
      const result2 = vad.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: false, confidence: 0, timestamp: 11_100, audioLevel: 0 },
      ]);
      // totalSpeech=600 > 500 → confidence+=0.1
      expect(result2.confidence).toBeGreaterThan(result.confidence);
    });

    it('should include totalSpeechDurationMs from segments when not speaking', () => {
      const vad = new EnergyVADProvider({
        silenceTimeout: 10,
        minSpeechDuration: 10,
        maxSpeechDuration: 50000,
        smoothingFactor: 0.1,
      });
      initNoiseFloor(vad);

      vad.process(speechChunk(10_500));
      vad.process(speechChunk(10_510));
      vad.process(speechChunk(10_520));
      vad.process(silenceChunk(10_530));
      vad.process(silenceChunk(10_540));
      vad.process(silenceChunk(10_550));

      expect((vad as unknown as { isSpeaking: boolean }).isSpeaking).toBe(false);
      expect((vad as unknown as { segments: unknown[] }).segments.length).toBeGreaterThanOrEqual(1);

      const result = vad.checkEndpoint([]);
      expect(result.isEndpoint).toBe(false);
      expect(result.totalSpeechDurationMs).toBeGreaterThan(0);
      expect(result.silenceDurationMs).toBeUndefined();
    });
  });

  describe('reset()', () => {
    it('should clear all internal state', () => {
      const vad = new EnergyVADProvider();
      initNoiseFloor(vad);
      vad.process(speechChunk(10_500));

      vad.reset();

      expect((vad as unknown as { noiseFloorInitialized: boolean }).noiseFloorInitialized).toBe(
        false,
      );
      expect((vad as unknown as { isSpeaking: boolean }).isSpeaking).toBe(false);
      expect((vad as unknown as { speechHistory: unknown[] }).speechHistory.length).toBe(0);

      const result = vad.process(speechChunk(10_600));
      expect(result.isSpeech).toBe(false);
    });
  });
});

describe('SemanticEndpointDetector', () => {
  describe('constructor and properties', () => {
    it('should expose inner VAD sample rate', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      expect(d.name).toBe('semantic-endpoint');
      expect(d.sampleRate).toBe(8000);
    });

    it('should create with convenience factory', () => {
      const d = createSemanticEndpointDetector({ silenceTimeout: 200 }, { minUtteranceLength: 3 });
      expect(d).toBeInstanceOf(SemanticEndpointDetector);
    });

    it('should use custom patterns', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({
        vadProvider: inner,
        continuePatterns: [/testing\s*$/i],
        completePatterns: [/done/i],
      });
      expect(d).toBeDefined();
    });
  });

  describe('process()', () => {
    it('should delegate to inner VAD provider', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      const spy = vi.spyOn(inner, 'process');
      const chunk = silenceChunk(10_500);
      d.process(chunk);
      expect(spy).toHaveBeenCalledWith(chunk);
    });
  });

  describe('feedUtterance()', () => {
    it('should store utterance text and confidence', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      d.feedUtterance('Hello world', 0.95);
      expect((d as unknown as { lastUtteranceText: string }).lastUtteranceText).toBe('Hello world');
    });

    it('should ignore empty text', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      d.feedUtterance('', 0.95);
      expect((d as unknown as { lastUtteranceText: string }).lastUtteranceText).toBe('');
    });

    it('should ignore whitespace-only text', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      d.feedUtterance('   ', 0.95);
      expect((d as unknown as { lastUtteranceText: string }).lastUtteranceText).toBe('');
    });
  });

  describe('checkEndpoint()', () => {
    function innerVadReturnsEndpoint(
      maxSpeechDuration = 200,
      silenceTimeout = 10000,
    ): EnergyVADProvider {
      const v = new EnergyVADProvider({ silenceTimeout, maxSpeechDuration, minSpeechDuration: 10 });
      initNoiseFloor(v);
      v.process(speechChunk(10_500));
      return v;
    }

    it('should return base result when inner VAD does not detect endpoint', () => {
      const inner = new EnergyVADProvider({ maxSpeechDuration: 50000, silenceTimeout: 50000 });
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      const result = d.checkEndpoint([]);
      expect(result.isEndpoint).toBe(false);
    });

    it('should block endpoint for short utterances below minUtteranceLength', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({ vadProvider: inner, minUtteranceLength: 5 });
      d.feedUtterance('hi', 0.9);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(false);
      expect(result.confidence).toBe(0.3);
    });

    it('should allow endpoint for short utterances with complete pattern', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({
        vadProvider: inner,
        minUtteranceLength: 10,
        completePatterns: [/^bye$/i],
      });
      d.feedUtterance('bye', 0.9);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(true);
      expect(result.reason).toBe('semantic');
    });

    it('should block endpoint when utterance has continue pattern but no complete pattern', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({ vadProvider: inner, minUtteranceLength: 2 });
      d.feedUtterance('I want to go to the store and', 0.9);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(false);
      expect(result.reason).toBe('semantic');
      expect(result.confidence).toBe(0.4);
    });

    it('should allow endpoint for utterances with complete patterns', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({ vadProvider: inner, minUtteranceLength: 2 });
      d.feedUtterance('That is all I needed. Thanks', 0.95);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(true);
      expect(result.reason).toBe('semantic');
    });

    it('should increase confidence with question marks', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({ vadProvider: inner, minUtteranceLength: 2 });
      d.feedUtterance('What time is it? Are we there yet?', 0.9);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should include utterance confidence in semantic score', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({ vadProvider: inner, minUtteranceLength: 1 });
      d.feedUtterance('Hello', 0.5);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(true);
      // computeSemanticConfidence: base=1.0, complete? no, ?=0, length=5<20, +0.5*0.1=0.05
      // total = min(1.0, 1.0+0.05) = 1.0
      expect(result.confidence).toBe(1.0);
    });

    it('should handle both continue and complete pattern (complete wins)', () => {
      const inner = innerVadReturnsEndpoint(200);
      const d = new SemanticEndpointDetector({
        vadProvider: inner,
        minUtteranceLength: 2,
        continuePatterns: [/\band\s*$/i],
        completePatterns: [/thanks/i],
      });
      d.feedUtterance('Hello and thanks', 0.95);

      const result = d.checkEndpoint([
        { isSpeech: true, confidence: 0.9, timestamp: 10_500, audioLevel: 0.8 },
        { isSpeech: true, confidence: 0.9, timestamp: 10_800, audioLevel: 0.8 },
      ]);
      expect(result.isEndpoint).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should reset inner VAD and clear utterance state', () => {
      const inner = new EnergyVADProvider();
      const d = new SemanticEndpointDetector({ vadProvider: inner });
      d.feedUtterance('Hello world', 0.95);
      const spy = vi.spyOn(inner, 'reset');

      d.reset();

      expect(spy).toHaveBeenCalled();
      expect((d as unknown as { lastUtteranceText: string }).lastUtteranceText).toBe('');
    });
  });
});

describe('VAD factory', () => {
  it('createVADProvider with no config returns no-op provider', () => {
    const vad = createVADProvider();
    expect(vad.name).toBe('none');
    expect(vad.sampleRate).toBe(8000);

    const result = vad.process(silenceChunk(100));
    expect(result.isSpeech).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.audioLevel).toBe(0);

    const ep = vad.checkEndpoint([]);
    expect(ep.isEndpoint).toBe(false);
    expect(ep.reason).toBe('silence');

    vad.reset();
  });

  it('createVADProvider with provider none returns no-op', () => {
    const vad = createVADProvider({ provider: 'none' });
    expect(vad.name).toBe('none');
  });

  it('createVADProvider with provider energy returns EnergyVADProvider', () => {
    const vad = createVADProvider({ provider: 'energy' });
    expect(vad.name).toBe('energy-vad');
  });

  it('createVADProvider passes config options to EnergyVADProvider', () => {
    const vad = createVADProvider({
      provider: 'energy',
      energyThreshold: 3.0,
      silenceTimeoutMs: 1000,
      minSpeechDurationMs: 500,
      maxSpeechDurationMs: 8000,
    });
    expect(vad.name).toBe('energy-vad');
  });

  it('createDefaultVADProvider returns EnergyVADProvider with defaults', () => {
    const vad = createDefaultVADProvider();
    expect(vad.name).toBe('energy-vad');
    expect(vad.sampleRate).toBe(8000);
  });
});
