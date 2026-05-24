import { EventEmitter } from 'events';

import type { STTProvider, TTSProvider } from '../pipeline/index.js';
import type { AudioChunk, Utterance } from '../types/index.js';
import { type CompositeProviderOptions, FailoverManager, type ProviderHealth } from './failover.js';

export type { CompositeProviderOptions, ProviderHealth };

/**
 * Composite STT provider that chains multiple STT providers with automatic
 * failover, health tracking, and circuit-breaking.
 *
 * On connection or stream failure, the composite automatically switches to
 * the next healthy provider in the priority chain.
 *
 * @example
 * ```typescript
 * const stt = new CompositeSTTProvider(
 *   { providers: ['deepgram', 'aws'] },
 *   (name) => createSTTProvider(name),
 * );
 * await stt.connect(config);
 * stt.streamAudio(chunk);
 * ```
 */
export class CompositeSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'composite-stt';

  private providers: STTProvider[];
  private failoverManager: FailoverManager;
  private activeProviderIndex = 0;
  private utteranceCallbacks: Array<(utterance: Utterance) => void> = [];
  private endOfSpeechCallbacks: Array<() => void> = [];
  private connected = false;

  constructor(options: CompositeProviderOptions, createProvider: (name: string) => STTProvider) {
    super();
    this.providers = options.providers.map((name) => createProvider(name));
    this.failoverManager = new FailoverManager(options);
    this.setupProviderListeners();
  }

  /**
   * Connect all providers in priority order. The first successfully
   * connected healthy provider becomes the active provider. Throws if no
   * providers can connect.
   */
  async connect(config: unknown): Promise<void> {
    for (const provider of this.providers) {
      try {
        await provider.connect(config);
        this.failoverManager.recordSuccess(provider.name);
      } catch (error) {
        this.failoverManager.recordFailure(
          provider.name,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    const healthyNames = this.failoverManager.getHealthyProviders();
    if (healthyNames.length === 0) {
      throw new Error('CompositeSTTProvider: no healthy providers available after connect');
    }

    const firstIndex = this.providers.findIndex((p) => p.name === healthyNames[0]);
    this.activeProviderIndex = firstIndex !== -1 ? firstIndex : 0;
    this.connected = true;

    this.failoverManager.startPeriodicHealthCheck();
  }

  /**
   * Stream an audio chunk to the currently active STT provider.
   * On error, automatically fails over to the next healthy provider.
   */
  streamAudio(chunk: AudioChunk): void {
    if (!this.connected) {
      return;
    }

    const activeProvider = this.providers[this.activeProviderIndex];
    if (!activeProvider) {
      return;
    }

    try {
      activeProvider.streamAudio(chunk);
    } catch (error) {
      this.failoverManager.recordFailure(
        activeProvider.name,
        error instanceof Error ? error : new Error(String(error)),
      );
      void this.failover();
    }
  }

  /**
   * Register a callback for utterance events. All providers' utterances
   * are forwarded through this callback regardless of which provider is active.
   */
  onUtterance(cb: (utterance: Utterance) => void): void {
    this.utteranceCallbacks.push(cb);
  }

  /**
   * Register a callback for end-of-speech events.
   */
  onEndOfSpeech(cb: () => void): void {
    this.endOfSpeechCallbacks.push(cb);
  }

  /**
   * Returns a snapshot of health status for all tracked providers.
   */
  getHealth(): ProviderHealth[] {
    return this.failoverManager.getAllHealth();
  }

  /**
   * Get the underlying FailoverManager for advanced monitoring.
   */
  getFailoverManager(): FailoverManager {
    return this.failoverManager;
  }

  /**
   * Close all providers and stop periodic health checks.
   */
  async close(): Promise<void> {
    this.connected = false;
    this.failoverManager.stopPeriodicHealthCheck();
    for (const provider of this.providers) {
      try {
        await provider.close();
      } catch {
        // silently ignore close errors on individual providers
      }
    }
    this.utteranceCallbacks = [];
    this.endOfSpeechCallbacks = [];
  }

  private setupProviderListeners(): void {
    for (const provider of this.providers) {
      provider.onUtterance((utterance: Utterance) => {
        for (const cb of this.utteranceCallbacks) {
          cb(utterance);
        }
      });

      provider.onEndOfSpeech(() => {
        for (const cb of this.endOfSpeechCallbacks) {
          cb();
        }
      });
    }

    // Listen for error events on EventEmitter-based providers
    for (const provider of this.providers) {
      if (provider instanceof EventEmitter) {
        provider.on('error', (err: Error) => {
          this.failoverManager.recordFailure(provider.name, err);
          if (this.providers[this.activeProviderIndex]?.name === provider.name) {
            void this.failover();
          }
        });
      }
    }
  }

  private async failover(): Promise<void> {
    const current = this.providers[this.activeProviderIndex];
    const currentName = current?.name;
    if (!currentName) {
      return;
    }

    const nextName = this.failoverManager.getNextProvider(currentName);
    if (!nextName) {
      return;
    }

    const nextIndex = this.providers.findIndex((p) => p.name === nextName);
    if (nextIndex === -1) {
      return;
    }

    const from = currentName;

    // Try to connect the next provider if not already connected
    try {
      await this.providers[nextIndex].connect({});
      this.failoverManager.recordSuccess(nextName);
    } catch (error) {
      this.failoverManager.recordFailure(
        nextName,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Try the next one in the chain
      await this.failover();
      return;
    }

    this.activeProviderIndex = nextIndex;
    this.failoverManager.emit('provider:failover', {
      from,
      to: nextName,
      error: `Failed over from ${from}`,
    });
  }
}

/**
 * Composite TTS provider that chains multiple TTS providers with automatic
 * failover, health tracking, and circuit-breaking.
 *
 * On synthesis failure (before any audio chunks are yielded), the composite
 * automatically retries with the next healthy provider.
 *
 * @example
 * ```typescript
 * const tts = new CompositeTTSProvider(
 *   { providers: ['deepgram', 'aws'] },
 *   (name) => createTTSProvider(name),
 * );
 * await tts.connect?.(config);
 * for await (const chunk of tts.synthesize('Hello', config)) {
 *   // send audio chunk
 * }
 * ```
 */
export class CompositeTTSProvider implements TTSProvider {
  readonly name = 'composite-tts';
  readonly supportsStreaming = true;
  readonly firstByteLatencyMs: number | null = null;

  private providers: TTSProvider[];
  private failoverManager: FailoverManager;

  constructor(options: CompositeProviderOptions, createProvider: (name: string) => TTSProvider) {
    this.providers = options.providers.map((name) => createProvider(name));
    this.failoverManager = new FailoverManager(options);
  }

  /**
   * Synthesize text to audio using healthy providers in priority order.
   * On failure (before yielding any chunks), automatically retries with
   * the next healthy provider. If no providers succeed, throws an error.
   */
  async *synthesize(text: string, config: unknown): AsyncIterable<AudioChunk> {
    const healthyNames = this.failoverManager.getHealthyProviders();

    for (const name of healthyNames) {
      const provider = this.providers.find((p) => p.name === name);
      if (!provider) {
        continue;
      }

      let yieldedAny = false;

      try {
        for await (const chunk of provider.synthesize(text, config)) {
          yieldedAny = true;
          yield chunk;
        }
        this.failoverManager.recordSuccess(name);
        return;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.failoverManager.recordFailure(name, err);

        if (yieldedAny) {
          throw new Error(
            `CompositeTTSProvider: provider "${name}" failed mid-synthesis after yielding chunks: ${err.message}`,
          );
        }
        // Try next provider
      }
    }

    throw new Error('CompositeTTSProvider: all TTS providers failed to synthesize');
  }

  /**
   * Connect all underlying TTS providers (where supported).
   */
  async connect(config: unknown): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.connect) {
        continue;
      }
      try {
        await provider.connect(config);
        this.failoverManager.recordSuccess(provider.name);
      } catch (error) {
        this.failoverManager.recordFailure(
          provider.name,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    const healthyNames = this.failoverManager.getHealthyProviders();
    if (healthyNames.length === 0) {
      throw new Error('CompositeTTSProvider: no healthy providers available after connect');
    }

    this.failoverManager.startPeriodicHealthCheck();
  }

  /**
   * Cancel synthesis on all underlying providers.
   */
  cancel(): void {
    for (const provider of this.providers) {
      try {
        provider.cancel?.();
      } catch {
        // silently ignore
      }
    }
  }

  /**
   * Close all providers and stop periodic health checks.
   */
  async close(): Promise<void> {
    this.failoverManager.stopPeriodicHealthCheck();
    for (const provider of this.providers) {
      try {
        await provider.close?.();
      } catch {
        // silently ignore close errors
      }
    }
  }

  /**
   * Returns a snapshot of health status for all tracked providers.
   */
  getHealth(): ProviderHealth[] {
    return this.failoverManager.getAllHealth();
  }

  /**
   * Get the underlying FailoverManager for advanced monitoring.
   */
  getFailoverManager(): FailoverManager {
    return this.failoverManager;
  }
}

/**
 * Factory function for creating a CompositeSTTProvider.
 */
export function createCompositeSTTProvider(
  options: CompositeProviderOptions,
  createProvider: (name: string) => STTProvider,
): CompositeSTTProvider {
  return new CompositeSTTProvider(options, createProvider);
}

/**
 * Factory function for creating a CompositeTTSProvider.
 */
export function createCompositeTTSProvider(
  options: CompositeProviderOptions,
  createProvider: (name: string) => TTSProvider,
): CompositeTTSProvider {
  return new CompositeTTSProvider(options, createProvider);
}
