export { RecordingManager } from './recording-manager.js';
export { FileSystemStorage } from './storage/filesystem-storage.js';
export { MemoryStorage } from './storage/memory-storage.js';
export { S3Storage } from './storage/s3-storage.js';
export { writeSessionJson, writeTranscriptFile, writeWavFile } from './wav-writer.js';

import type { RecordingConfig } from '../types/index.js';
import { RecordingManager } from './recording-manager.js';

export function createRecordingManager(config: RecordingConfig): RecordingManager {
  return new RecordingManager(config);
}
