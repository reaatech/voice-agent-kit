import { EventEmitter } from 'events';

import type {
  AudioChunk,
  CallRecording,
  PipelineEvent,
  RecordingConfig,
  TurnRecord,
} from '../types/index.js';
import { FileSystemStorage } from './storage/filesystem-storage.js';
import { MemoryStorage } from './storage/memory-storage.js';
import { S3Storage } from './storage/s3-storage.js';

export { FileSystemStorage } from './storage/filesystem-storage.js';
export { MemoryStorage } from './storage/memory-storage.js';
export { S3Storage } from './storage/s3-storage.js';

export class RecordingManager extends EventEmitter {
  private readonly config: RecordingConfig;
  private readonly activeRecordings: Map<string, CallRecording> = new Map();
  private readonly completedRecordings: Map<string, CallRecording> = new Map();

  private memoryStorage: MemoryStorage | null = null;
  private fileSystemStorage: FileSystemStorage | null = null;
  private s3Storage: S3Storage | null = null;

  constructor(config: RecordingConfig) {
    super();
    this.config = config;

    if (config.storage === 'memory') {
      this.memoryStorage = new MemoryStorage();
    } else if (config.storage === 'filesystem' && config.directory) {
      this.fileSystemStorage = new FileSystemStorage({ directory: config.directory });
    } else if (config.storage === 's3' && config.s3Bucket) {
      this.s3Storage = new S3Storage({
        bucket: config.s3Bucket,
        prefix: config.s3Prefix,
      });
    }
  }

  startRecording(sessionId: string, callSid: string, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.activeRecordings.has(sessionId)) {
      return;
    }

    const recording: CallRecording = {
      sessionId,
      callSid,
      startTime: Date.now(),
      audioChunks: [],
      turns: [],
      events: [],
      metadata: metadata ?? {},
    };

    this.activeRecordings.set(sessionId, recording);
    this.emit('recording:started', { sessionId, callSid });
  }

  recordAudioChunk(sessionId: string, chunk: AudioChunk, direction: 'inbound' | 'outbound'): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) {
      return;
    }

    if (this.config.saveAudio !== false) {
      recording.audioChunks.push(chunk);
    }

    this.emit('recording:audio', { sessionId, direction, chunkSize: chunk.buffer.length });
  }

  recordTurn(sessionId: string, turn: TurnRecord): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) {
      return;
    }

    recording.turns.push(turn);
    this.emit('recording:turn', { sessionId, turnId: turn.turnId });
  }

  recordEvent(sessionId: string, event: PipelineEvent): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) {
      return;
    }

    if (this.config.saveEvents !== false) {
      recording.events.push(event);
    }
  }

  async stopRecording(sessionId: string): Promise<CallRecording> {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) {
      throw new Error(`No active recording found for session: ${sessionId}`);
    }

    recording.endTime = Date.now();
    recording.duration = recording.endTime - recording.startTime;

    this.activeRecordings.delete(sessionId);
    this.completedRecordings.set(sessionId, recording);

    if (this.memoryStorage) {
      this.memoryStorage.save(recording);
    } else if (this.fileSystemStorage) {
      await this.fileSystemStorage.save(recording);
    } else if (this.s3Storage) {
      await this.s3Storage.save(recording);
    }

    this.emit('recording:stopped', {
      sessionId,
      duration: recording.duration,
      turns: recording.turns.length,
    });

    return recording;
  }

  getRecording(sessionId: string): CallRecording | undefined {
    return this.activeRecordings.get(sessionId) ?? this.completedRecordings.get(sessionId);
  }

  getAllRecordings(): CallRecording[] {
    return [
      ...Array.from(this.activeRecordings.values()),
      ...Array.from(this.completedRecordings.values()),
    ];
  }

  async saveToFile(recording: CallRecording, directory: string): Promise<string> {
    const storage = new FileSystemStorage({ directory });
    return storage.save(recording);
  }

  async saveToS3(recording: CallRecording, bucket: string, prefix: string): Promise<string> {
    const storage = new S3Storage({ bucket, prefix });
    return storage.save(recording);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  destroy(): void {
    this.activeRecordings.clear();
    this.completedRecordings.clear();
    this.removeAllListeners();
  }
}
