import type { CallRecording } from '../../types/index.js';
import { writeSessionJson, writeTranscriptFile, writeWavFile } from '../wav-writer.js';

export interface S3StorageOptions {
  bucket: string;
  prefix?: string;
  region?: string;
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

interface S3PutObjectCommandConfig {
  Bucket: string;
  Key: string;
  Body: Buffer | string;
  ContentType: string;
}

class S3OperationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'S3StorageError';
    if (cause instanceof Error) {
      this.stack = cause.stack;
    }
  }
}

export class S3Storage {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly region: string;
  private s3Client: S3ClientLike | null = null;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? 'voice-recordings/';
    this.region = options.region ?? 'us-east-1';
  }

  private async getClient(): Promise<S3ClientLike> {
    if (this.s3Client) {
      return this.s3Client;
    }

    try {
      // Dynamic import — @aws-sdk/client-s3 is an optional peer dependency
      const s3Module = (await import('@aws-sdk/client-s3')) as {
        S3Client: new (config: { region: string }) => S3ClientLike;
      };
      this.s3Client = new s3Module.S3Client({ region: this.region });
      return this.s3Client;
    } catch (error) {
      throw new S3OperationError(
        'Failed to initialize S3 client. Ensure @aws-sdk/client-s3 is installed as a peer dependency.',
        error,
      );
    }
  }

  private async putObject(
    key: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<string> {
    const client = await this.getClient();
    // Dynamic import — @aws-sdk/client-s3 is an optional peer dependency
    const s3Module = (await import('@aws-sdk/client-s3')) as {
      PutObjectCommand: new (config: S3PutObjectCommandConfig) => unknown;
    };

    const command = new s3Module.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);
    return `s3://${this.bucket}/${key}`;
  }

  async save(recording: CallRecording): Promise<string> {
    const basePath = `${this.prefix}${recording.sessionId}`;
    const results: string[] = [];

    // Save audio
    if (recording.audioChunks.length > 0) {
      const userChunks = recording.turns.flatMap((t) => t.userAudio ?? []);
      const agentChunks = recording.turns.flatMap((t) => t.agentAudio ?? []);

      if (userChunks.length > 0) {
        const wavBuffer = writeWavFile(userChunks);
        const location = await this.putObject(`${basePath}/user_audio.wav`, wavBuffer, 'audio/wav');
        results.push(location);
      }

      if (agentChunks.length > 0) {
        const wavBuffer = writeWavFile(agentChunks);
        const location = await this.putObject(
          `${basePath}/agent_audio.wav`,
          wavBuffer,
          'audio/wav',
        );
        results.push(location);
      }

      if (userChunks.length === 0 && agentChunks.length === 0) {
        const wavBuffer = writeWavFile(recording.audioChunks);
        const location = await this.putObject(`${basePath}/audio.wav`, wavBuffer, 'audio/wav');
        results.push(location);
      }
    }

    // Save transcript
    if (recording.turns.length > 0) {
      const transcript = writeTranscriptFile(recording.turns);
      await this.putObject(`${basePath}/transcript.md`, transcript, 'text/markdown');
      results.push(`s3://${this.bucket}/${basePath}/transcript.md`);
    }

    // Save session metadata
    const sessionJson = writeSessionJson(recording);
    await this.putObject(`${basePath}/session.json`, sessionJson, 'application/json');
    results.push(`s3://${this.bucket}/${basePath}/session.json`);

    return `s3://${this.bucket}/${basePath}/`;
  }

  async getMeta(sessionId: string): Promise<CallRecording | undefined> {
    try {
      const client = await this.getClient();
      // Dynamic import — @aws-sdk/client-s3 is an optional peer dependency
      const s3Module = (await import('@aws-sdk/client-s3')) as {
        GetObjectCommand: new (config: { Bucket: string; Key: string }) => unknown;
      };

      const key = `${this.prefix}${sessionId}/session.json`;
      const command = new s3Module.GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = (await client.send(command)) as {
        Body?: { transformToString(): Promise<string> };
      };

      if (response.Body) {
        const content = await response.Body.transformToString();
        return JSON.parse(content) as CallRecording;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}
