import type { CallRecording } from '../../types/index.js';

export interface MemoryStorageOptions {
  maxRecordings?: number;
}

export class MemoryStorage {
  private recordings: Map<string, CallRecording> = new Map();
  private readonly maxRecordings: number;

  constructor(options: MemoryStorageOptions = {}) {
    this.maxRecordings = options.maxRecordings ?? 100;
  }

  save(recording: CallRecording): string {
    this.recordings.set(recording.sessionId, recording);

    if (this.recordings.size > this.maxRecordings) {
      const firstKey = this.recordings.keys().next().value;
      if (firstKey) {
        this.recordings.delete(firstKey);
      }
    }

    return `memory://${recording.sessionId}`;
  }

  get(sessionId: string): CallRecording | undefined {
    return this.recordings.get(sessionId);
  }

  getAll(): CallRecording[] {
    return Array.from(this.recordings.values());
  }

  delete(sessionId: string): boolean {
    return this.recordings.delete(sessionId);
  }

  clear(): void {
    this.recordings.clear();
  }

  count(): number {
    return this.recordings.size;
  }
}
