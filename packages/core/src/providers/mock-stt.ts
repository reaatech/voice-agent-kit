import { EventEmitter } from 'events';

import type { STTProvider } from '../pipeline/index.js';
import type { AudioChunk, Utterance } from '../types/index.js';


export interface MockSTTOptions {
  delay?: number;
  transcripts?: string[];
  confidence?: number;
  interimCount?: number;
  autoEndOfSpeech?: boolean;
  endOfSpeechDelay?: number;
}

export class MockSTTProvider extends EventEmitter implements STTProvider {
  readonly name = 'mock-stt';
  private options: MockSTTOptions;
  private utteranceCallback?: (utterance: Utterance) => void;
  private endOfSpeechCallback?: () => void;
  private transcriptIndex = 0;
  private audioBuffer: Buffer[] = [];
  private isConnected = false;

  constructor(options: MockSTTOptions = {}) {
    super();
    this.options = {
      delay: 100,
      transcripts: ['Hello, how can I help you today?', "I'd like to book an appointment.", 'What time works for you?'],
      confidence: 0.95,
      interimCount: 2,
      autoEndOfSpeech: true,
      endOfSpeechDelay: 500,
      ...options,
    };
  }

  async connect(): Promise<void> {
    this.isConnected = true;
    this.transcriptIndex = 0;
  }

  streamAudio(chunk: AudioChunk): void {
    if (!this.isConnected) {
      return;
    }

    this.audioBuffer.push(chunk.buffer);

    // Simulate processing delay
    setTimeout(() => {
      void this.processAudio();
    }, this.options.delay);
  }

  private async processAudio(): Promise<void> {
    if (!this.utteranceCallback) {return;}

    const transcript = this.options.transcripts?.[this.transcriptIndex % (this.options.transcripts?.length ?? 1)] ?? 'Hello';
    
    // Send interim results
    const interimCount = this.options.interimCount ?? 2;
    for (let i = 1; i <= interimCount; i++) {
      const partialText = transcript.substring(0, Math.floor((transcript.length / interimCount) * i));
      
      this.utteranceCallback({
        transcript: partialText,
        confidence: (this.options.confidence ?? 0.9) * (i / interimCount),
        isFinal: false,
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, this.options.delay));
    }

    // Send final result
    this.utteranceCallback({
      transcript,
      confidence: this.options.confidence ?? 0.95,
      isFinal: true,
      timestamp: Date.now(),
      durationMs: this.audioBuffer.length * 20, // Assume 20ms per chunk
    });

    this.audioBuffer = [];
    this.transcriptIndex++;

    // Auto-trigger end of speech
    if (this.options.autoEndOfSpeech) {
      setTimeout(() => {
        this.endOfSpeechCallback?.();
      }, this.options.endOfSpeechDelay);
    }
  }

  onUtterance(cb: (utterance: Utterance) => void): void {
    this.utteranceCallback = cb;
  }

  onEndOfSpeech(cb: () => void): void {
    this.endOfSpeechCallback = cb;
  }

  async close(): Promise<void> {
    this.isConnected = false;
    this.audioBuffer = [];
    this.utteranceCallback = undefined;
    this.endOfSpeechCallback = undefined;
  }

  // Test helper to trigger end of speech manually
  triggerEndOfSpeech(): void {
    this.endOfSpeechCallback?.();
  }

  // Test helper to reset state
  reset(): void {
    this.transcriptIndex = 0;
    this.audioBuffer = [];
  }
}

export function createMockSTTProvider(options?: MockSTTOptions): MockSTTProvider {
  return new MockSTTProvider(options);
}
