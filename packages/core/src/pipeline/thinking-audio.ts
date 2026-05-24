import type { AudioChunk, ThinkingAudioConfig } from '../types/index.js';

interface ThinkingTurn {
  turnId: string;
  startedAt: number;
  isActive: boolean;
  timer?: NodeJS.Timeout;
  fillerInterval?: NodeJS.Timeout;
}

export class ThinkingAudioManager {
  private readonly config: Required<ThinkingAudioConfig>;
  private readonly activeTurns: Map<string, ThinkingTurn> = new Map();
  private readonly onSendAudio: (chunk: AudioChunk) => void;
  private destroyed = false;

  constructor(config: ThinkingAudioConfig, onSendAudio: (chunk: AudioChunk) => void) {
    this.config = {
      enabled: config.enabled ?? false,
      strategy: config.strategy ?? 'none',
      backchannelPhrases: config.backchannelPhrases ?? [],
      fillerToneHz: config.fillerToneHz ?? 440,
      fillerVolume: config.fillerVolume ?? 0.1,
      maxDurationMs: config.maxDurationMs ?? 800,
    };
    this.onSendAudio = onSendAudio;
  }

  async startThinking(turnId: string): Promise<void> {
    if (this.destroyed || !this.config.enabled || this.config.strategy === 'none') {
      return;
    }

    if (this.activeTurns.has(turnId)) {
      return;
    }

    const turn: ThinkingTurn = {
      turnId,
      startedAt: Date.now(),
      isActive: true,
    };

    this.activeTurns.set(turnId, turn);

    if (this.config.strategy === 'filler') {
      this.startFillerAudio(turn);
    } else if (this.config.strategy === 'backchannel') {
      this.sendBackchannelPhrase(turn);
    } else if (this.config.strategy === 'silence') {
      this.sendSilenceChunk(turn);
    }
  }

  stopThinking(turnId: string): void {
    const turn = this.activeTurns.get(turnId);

    if (!turn) {
      return;
    }

    turn.isActive = false;

    if (turn.timer) {
      clearTimeout(turn.timer);
      turn.timer = undefined;
    }

    if (turn.fillerInterval) {
      clearInterval(turn.fillerInterval);
      turn.fillerInterval = undefined;
    }

    this.activeTurns.delete(turnId);
  }

  isActive(turnId: string): boolean {
    const turn = this.activeTurns.get(turnId);
    return turn?.isActive ?? false;
  }

  destroy(): void {
    this.destroyed = true;

    for (const [turnId] of this.activeTurns) {
      this.stopThinking(turnId);
    }

    this.activeTurns.clear();
  }

  private startFillerAudio(turn: ThinkingTurn): void {
    const chunkDurationMs = 160;
    let elapsed = 0;
    const maxDuration = this.config.maxDurationMs;

    const sendChunk = (): void => {
      if (!turn.isActive || this.destroyed || elapsed >= maxDuration) {
        this.stopThinking(turn.turnId);
        return;
      }

      const tone = generateFillerTone(
        chunkDurationMs,
        this.config.fillerToneHz,
        this.config.fillerVolume,
        8000,
      );

      const chunk: AudioChunk = {
        buffer: tone,
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      this.onSendAudio(chunk);
      elapsed += chunkDurationMs;
    };

    sendChunk();
    turn.fillerInterval = setInterval(sendChunk, chunkDurationMs);
    turn.fillerInterval.unref?.();
  }

  private sendBackchannelPhrase(turn: ThinkingTurn): void {
    const phrases = this.config.backchannelPhrases;

    if (phrases.length === 0) {
      return;
    }

    const silence = createSilenceChunk(8000);
    silence.timestamp = Date.now();
    this.onSendAudio(silence);

    turn.timer = setTimeout(() => {
      if (!turn.isActive) return;
      this.stopThinking(turn.turnId);
    }, this.config.maxDurationMs);
    turn.timer.unref?.();
  }

  private sendSilenceChunk(turn: ThinkingTurn): void {
    const chunk = createSilenceChunk(8000);
    chunk.timestamp = Date.now();
    this.onSendAudio(chunk);

    turn.timer = setTimeout(() => {
      if (turn.isActive) {
        this.stopThinking(turn.turnId);
      }
    }, this.config.maxDurationMs);
    turn.timer.unref?.();
  }
}

export function linear16ToMulaw(sample16: number): number {
  let sample = sample16;
  const sign = sample < 0 ? 1 : 0;
  sample = Math.abs(sample);

  if (sample > 8159) {
    sample = 8159;
  }

  sample += 132;

  let exponent = 0;
  while (sample > 255) {
    sample >>= 1;
    exponent++;
  }

  const mantissa = (sample >> 4) & 0x0f;
  return ~((sign << 7) | (exponent << 4) | mantissa) & 0xff;
}

export function generateFillerTone(
  durationMs: number,
  frequency = 440,
  volume = 0.1,
  sampleRate = 8000,
): Buffer {
  const numSamples = Math.floor((sampleRate / 1000) * durationMs);
  const buffer = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const linearSample = Math.sin(2 * Math.PI * frequency * t) * volume * 16384;
    const clipped = Math.max(-32768, Math.min(32767, Math.round(linearSample)));
    buffer[i] = linear16ToMulaw(clipped);
  }

  return buffer;
}

function createSilenceChunk(sampleRate: number): AudioChunk {
  return {
    buffer: Buffer.alloc(20, 0xff),
    sampleRate,
    encoding: 'mulaw',
    channels: 1,
    timestamp: Date.now(),
  };
}
