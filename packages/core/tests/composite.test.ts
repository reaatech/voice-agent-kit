import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { STTProvider, TTSProvider } from '../src/pipeline/index.js';
import {
  CompositeSTTProvider,
  CompositeTTSProvider,
  createCompositeSTTProvider,
  createCompositeTTSProvider,
} from '../src/providers/composite.js';
import type { AudioChunk, Utterance } from '../src/types/index.js';

function makeChunk(): AudioChunk {
  return {
    buffer: Buffer.alloc(160, 128),
    sampleRate: 8000,
    encoding: 'mulaw',
    channels: 1,
    timestamp: Date.now(),
  };
}

class InlineSTTProvider extends EventEmitter implements STTProvider {
  readonly name: string;
  connectFn: () => Promise<void>;
  closeFn: () => Promise<void>;
  streamCalls: AudioChunk[] = [];
  utteranceCbs: Array<(u: Utterance) => void> = [];
  eosCbs: Array<() => void> = [];
  connected = false;

  constructor(name: string, opts?: { connectFail?: boolean; closeFail?: boolean }) {
    super();
    this.name = name;
    this.connectFn = opts?.connectFail
      ? () => Promise.reject(new Error(`${name} connect failed`))
      : () => {
          this.connected = true;
          return Promise.resolve();
        };
    this.closeFn = opts?.closeFail
      ? () => Promise.reject(new Error(`${name} close failed`))
      : () => {
          this.connected = false;
          return Promise.resolve();
        };
  }

  async connect(): Promise<void> {
    return this.connectFn();
  }

  streamAudio(chunk: AudioChunk): void {
    this.streamCalls.push(chunk);
  }

  onUtterance(cb: (utterance: Utterance) => void): void {
    this.utteranceCbs.push(cb);
  }

  onEndOfSpeech(cb: () => void): void {
    this.eosCbs.push(cb);
  }

  async close(): Promise<void> {
    return this.closeFn();
  }

  emitUtterance(u: Utterance): void {
    for (const cb of this.utteranceCbs) cb(u);
  }

  emitEndOfSpeech(): void {
    for (const cb of this.eosCbs) cb();
  }
}

class InlineTTSProvider implements TTSProvider {
  readonly name: string;
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;
  private failOnSynthesize: boolean;
  private failMidSynthesis: boolean;
  cancelCalled = false;

  constructor(name: string, opts?: { failSynthesize?: boolean; failMidSynthesis?: boolean }) {
    this.name = name;
    this.failOnSynthesize = opts?.failSynthesize ?? false;
    this.failMidSynthesis = opts?.failMidSynthesis ?? false;
  }

  async *synthesize(_text: string, _config?: unknown): AsyncIterable<AudioChunk> {
    if (this.failOnSynthesize) {
      throw new Error(`${this.name} synthesize failed`);
    }
    if (this.failMidSynthesis) {
      yield makeChunk();
      throw new Error(`${this.name} mid-synthesis failed`);
    }
    yield makeChunk();
    yield makeChunk();
  }

  cancel(): void {
    this.cancelCalled = true;
  }

  async connect(): Promise<void> {
    // no-op for mock
  }

  async close(): Promise<void> {
    // no-op
  }
}

function createProvider(name: string, sttMap: Map<string, InlineSTTProvider>): STTProvider {
  const p = sttMap.get(name);
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

function createTTSProvider(name: string, ttsMap: Map<string, InlineTTSProvider>): TTSProvider {
  const p = ttsMap.get(name);
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

describe('CompositeSTTProvider', () => {
  let stt1: InlineSTTProvider;
  let stt2: InlineSTTProvider;
  let sttMap: Map<string, InlineSTTProvider>;
  let composite: CompositeSTTProvider;

  afterEach(async () => {
    try {
      await composite?.close();
    } catch {
      // ignore
    }
  });

  it('should construct with provider list from factory', () => {
    stt1 = new InlineSTTProvider('p1');
    stt2 = new InlineSTTProvider('p2');
    sttMap = new Map([
      ['p1', stt1],
      ['p2', stt2],
    ]);
    composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
      createProvider(n, sttMap),
    );
    expect(composite.name).toBe('composite-stt');
  });

  describe('connect()', () => {
    it('should connect all providers successfully', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );

      await composite.connect({});
      expect(stt1.connected).toBe(true);
      expect(stt2.connected).toBe(true);
    });

    it('should fail over when some providers fail to connect', async () => {
      stt1 = new InlineSTTProvider('p1', { connectFail: true });
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );

      await composite.connect({});
      expect(stt1.connected).toBe(false);
      expect(stt2.connected).toBe(true);
    });

    it('should throw when all providers fail to connect', async () => {
      stt1 = new InlineSTTProvider('p1', { connectFail: true });
      stt2 = new InlineSTTProvider('p2', { connectFail: true });
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider(
        { providers: ['p1', 'p2'], circuitBreakerThreshold: 1 },
        (n) => createProvider(n, sttMap),
      );

      await expect(composite.connect({})).rejects.toThrow(
        'CompositeSTTProvider: no healthy providers available after connect',
      );
    });
  });

  describe('streamAudio()', () => {
    it('should route chunks to active provider', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const chunk = makeChunk();
      composite.streamAudio(chunk);
      expect(stt1.streamCalls).toContain(chunk);
    });

    it('should be no-op when not connected', () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );

      const chunk = makeChunk();
      expect(() => composite.streamAudio(chunk)).not.toThrow();
    });

    it('should trigger failover when active provider errors on streamAudio', async () => {
      const errorProvider = new InlineSTTProvider('p1');
      const _originalStream = errorProvider.streamAudio.bind(errorProvider);
      errorProvider.streamAudio = () => {
        throw new Error('stream error');
      };

      stt1 = errorProvider;
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const chunk = makeChunk();
      composite.streamAudio(chunk);
    });
  });

  describe('event forwarding', () => {
    it('should forward utterance events from all providers', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const utterances: Utterance[] = [];
      composite.onUtterance((u) => utterances.push(u));

      const u1: Utterance = { transcript: 'hello', confidence: 0.9, isFinal: true, timestamp: 1 };
      stt1.emitUtterance(u1);
      expect(utterances).toContain(u1);

      const u2: Utterance = { transcript: 'world', confidence: 0.8, isFinal: true, timestamp: 2 };
      stt2.emitUtterance(u2);
      expect(utterances).toContain(u2);
    });

    it('should forward end-of-speech events from all providers', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const eosSpy = vi.fn();
      composite.onEndOfSpeech(eosSpy);

      stt1.emitEndOfSpeech();
      expect(eosSpy).toHaveBeenCalledTimes(1);

      stt2.emitEndOfSpeech();
      expect(eosSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHealth() and getFailoverManager()', () => {
    it('should return health statuses', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const health = composite.getHealth();
      expect(health).toHaveLength(2);
      expect(health[0].provider).toBe('p1');
      expect(health[0].isHealthy).toBe(true);
    });

    it('should return failover manager', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      const fm = composite.getFailoverManager();
      expect(fm).toBeDefined();
      expect(fm.getHealthyProviders()).toEqual(['p1', 'p2']);
    });
  });

  describe('close()', () => {
    it('should close all providers and clear callbacks', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      await composite.close();
      expect(stt1.connected).toBe(false);
      expect(stt2.connected).toBe(false);
    });

    it('should silently ignore provider close errors', async () => {
      const closeFail1 = new InlineSTTProvider('p1', { closeFail: true });
      const closeFail2 = new InlineSTTProvider('p2', { closeFail: true });
      const failMap = new Map([
        ['p1', closeFail1],
        ['p2', closeFail2],
      ]);
      const comp = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, failMap),
      );
      await comp.connect({});

      await expect(comp.close()).resolves.toBeUndefined();
    });
  });

  describe('error event handling', () => {
    it('should record failure and failover on error from active EventEmitter provider', async () => {
      stt1 = new InlineSTTProvider('p1');
      stt2 = new InlineSTTProvider('p2');
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider({ providers: ['p1', 'p2'] }, (n) =>
        createProvider(n, sttMap),
      );
      await composite.connect({});

      stt1.emit('error', new Error('p1 error'));
    });

    it('should handle failover with all providers unhealthy gracefully', async () => {
      stt1 = new InlineSTTProvider('p1', { connectFail: true });
      stt2 = new InlineSTTProvider('p2', { connectFail: true });
      sttMap = new Map([
        ['p1', stt1],
        ['p2', stt2],
      ]);
      composite = new CompositeSTTProvider(
        { providers: ['p1', 'p2'], circuitBreakerThreshold: 1 },
        (n) => createProvider(n, sttMap),
      );

      await expect(composite.connect({})).rejects.toThrow();
    });
  });
});

describe('CompositeTTSProvider', () => {
  let tts1: InlineTTSProvider;
  let tts2: InlineTTSProvider;
  let ttsMap: Map<string, InlineTTSProvider>;
  let composite: CompositeTTSProvider;

  afterEach(async () => {
    try {
      await composite?.close();
    } catch {
      // ignore
    }
  });

  it('should construct with provider list from factory', () => {
    tts1 = new InlineTTSProvider('p1');
    tts2 = new InlineTTSProvider('p2');
    ttsMap = new Map([
      ['p1', tts1],
      ['p2', tts2],
    ]);
    composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
      createTTSProvider(n, ttsMap),
    );
    expect(composite.name).toBe('composite-tts');
    expect(composite.supportsStreaming).toBe(true);
  });

  describe('connect()', () => {
    it('should connect all providers successfully', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );

      await composite.connect({});
    });

    it('should throw when all providers fail to connect', async () => {
      const p1 = new InlineTTSProvider('p1');
      const _originalConnect = p1.connect.bind(p1);
      p1.connect = () => Promise.reject(new Error('p1 connect fail'));

      const p2 = new InlineTTSProvider('p2');
      p2.connect = () => Promise.reject(new Error('p2 connect fail'));

      ttsMap = new Map([
        ['p1', p1],
        ['p2', p2],
      ]);
      composite = new CompositeTTSProvider(
        { providers: ['p1', 'p2'], circuitBreakerThreshold: 1 },
        (n) => createTTSProvider(n, ttsMap),
      );

      await expect(composite.connect({})).rejects.toThrow(
        'CompositeTTSProvider: no healthy providers available after connect',
      );
    });
  });

  describe('synthesize()', () => {
    it('should yield chunks from the active provider', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2', { failSynthesize: true });
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const chunks: AudioChunk[] = [];
      for await (const chunk of composite.synthesize('hello', {})) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(2);
    });

    it('should fail over to next provider on synthesis error', async () => {
      tts1 = new InlineTTSProvider('p1', { failSynthesize: true });
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const chunks: AudioChunk[] = [];
      for await (const chunk of composite.synthesize('hello', {})) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(2);
    });

    it('should throw if first provider succeeds and yields but second fails to connect', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const chunks: AudioChunk[] = [];
      for await (const chunk of composite.synthesize('hello', {})) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(2);
    });

    it('should throw when mid-synthesis failure occurs after yielding chunks', async () => {
      tts1 = new InlineTTSProvider('p1', { failMidSynthesis: true });
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const chunks: AudioChunk[] = [];
      await expect(async () => {
        for await (const chunk of composite.synthesize('hello', {})) {
          chunks.push(chunk);
        }
      }).rejects.toThrow('mid-synthesis');
    });

    it('should throw when all providers fail', async () => {
      tts1 = new InlineTTSProvider('p1', { failSynthesize: true });
      tts2 = new InlineTTSProvider('p2', { failSynthesize: true });
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      await expect(async () => {
        for await (const _ of composite.synthesize('hello', {})) {
          // consume
        }
      }).rejects.toThrow('CompositeTTSProvider: all TTS providers failed to synthesize');
    });
  });

  describe('cancel()', () => {
    it('should call cancel on all providers', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );

      composite.cancel();
      expect(tts1.cancelCalled).toBe(true);
      expect(tts2.cancelCalled).toBe(true);
    });
  });

  describe('close()', () => {
    it('should close without error', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );

      await expect(composite.close()).resolves.toBeUndefined();
    });
  });

  describe('getHealth() and getFailoverManager()', () => {
    it('should return health statuses', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const health = composite.getHealth();
      expect(health).toHaveLength(2);
    });

    it('should return failover manager', async () => {
      tts1 = new InlineTTSProvider('p1');
      tts2 = new InlineTTSProvider('p2');
      ttsMap = new Map([
        ['p1', tts1],
        ['p2', tts2],
      ]);
      composite = new CompositeTTSProvider({ providers: ['p1', 'p2'] }, (n) =>
        createTTSProvider(n, ttsMap),
      );
      await composite.connect({});

      const fm = composite.getFailoverManager();
      expect(fm).toBeDefined();
      expect(fm.getHealthyProviders()).toEqual(['p1', 'p2']);
    });
  });
});

describe('factory functions', () => {
  it('createCompositeSTTProvider should create a CompositeSTTProvider', async () => {
    const p1 = new InlineSTTProvider('p1');
    const p2 = new InlineSTTProvider('p2');
    const map = new Map([
      ['p1', p1],
      ['p2', p2],
    ]);
    const composite = createCompositeSTTProvider(
      { providers: ['p1', 'p2'] },
      (n) => map.get(n) as MockTTSProvider,
    );
    expect(composite.name).toBe('composite-stt');
    await composite.close();
  });

  it('createCompositeTTSProvider should create a CompositeTTSProvider', async () => {
    const p1 = new InlineTTSProvider('p1');
    const p2 = new InlineTTSProvider('p2');
    const map = new Map([
      ['p1', p1],
      ['p2', p2],
    ]);
    const composite = createCompositeTTSProvider(
      { providers: ['p1', 'p2'] },
      (n) => map.get(n) as MockTTSProvider,
    );
    expect(composite.name).toBe('composite-tts');
    await composite.close();
  });
});
