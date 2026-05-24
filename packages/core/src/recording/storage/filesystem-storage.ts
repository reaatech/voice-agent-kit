import { readdirSync, statSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { CallRecording } from '../../types/index.js';
import { writeSessionJson, writeTranscriptFile, writeWavFile } from '../wav-writer.js';

export interface FileSystemStorageOptions {
  directory: string;
  maxFiles?: number;
}

export class FileSystemStorage {
  private readonly directory: string;
  private readonly maxFiles: number;

  constructor(options: FileSystemStorageOptions) {
    this.directory = options.directory;
    this.maxFiles = options.maxFiles ?? 500;
  }

  async save(recording: CallRecording): Promise<string> {
    const sessionDir = join(this.directory, recording.sessionId);
    await mkdir(sessionDir, { recursive: true });

    const results: string[] = [];

    // Save audio as WAV
    if (recording.audioChunks.length > 0) {
      const userChunks = recording.turns.flatMap((t) => t.userAudio ?? []);
      const agentChunks = recording.turns.flatMap((t) => t.agentAudio ?? []);

      if (userChunks.length > 0) {
        const userWav = writeWavFile(userChunks);
        await writeFile(join(sessionDir, 'user_audio.wav'), userWav);
        results.push(join(sessionDir, 'user_audio.wav'));
      }

      if (agentChunks.length > 0) {
        const agentWav = writeWavFile(agentChunks);
        await writeFile(join(sessionDir, 'agent_audio.wav'), agentWav);
        results.push(join(sessionDir, 'agent_audio.wav'));
      }

      if (userChunks.length === 0 && agentChunks.length === 0) {
        const combinedWav = writeWavFile(recording.audioChunks);
        await writeFile(join(sessionDir, 'audio.wav'), combinedWav);
        results.push(join(sessionDir, 'audio.wav'));
      }
    }

    // Save transcript
    if (recording.turns.length > 0) {
      const transcript = writeTranscriptFile(recording.turns);
      await writeFile(join(sessionDir, 'transcript.md'), transcript);
      results.push(join(sessionDir, 'transcript.md'));
    }

    // Save session JSON
    const sessionJson = writeSessionJson(recording);
    await writeFile(join(sessionDir, 'session.json'), sessionJson);
    results.push(join(sessionDir, 'session.json'));

    await this.enforceMaxFiles();

    return sessionDir;
  }

  private async enforceMaxFiles(): Promise<void> {
    const files = readdirSync(this.directory)
      .map((name) => {
        const filePath = join(this.directory, name);
        try {
          return { path: filePath, mtime: statSync(filePath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((f): f is { path: string; mtime: number } => f !== null)
      .sort((a, b) => a.mtime - b.mtime);

    while (files.length > this.maxFiles) {
      const oldest = files.shift();
      if (oldest) {
        try {
          const { rm } = await import('fs/promises');
          await rm(oldest.path, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  async getMeta(sessionId: string): Promise<CallRecording | undefined> {
    const sessionFile = join(this.directory, sessionId, 'session.json');
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(sessionFile, 'utf-8');
      return JSON.parse(content) as CallRecording;
    } catch {
      return undefined;
    }
  }
}
