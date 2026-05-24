import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import type { AudioChunk } from '@reaatech/voice-agent-core';

interface WavHeader {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  dataSize: number;
  dataOffset: number;
  audioFormat: number;
}

function parseWavHeader(buffer: Buffer): WavHeader {
  if (buffer.toString('utf8', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file: missing RIFF header');
  }

  if (buffer.toString('utf8', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV file: missing WAVE identifier');
  }

  const audioFormat = buffer.readUInt16LE(20);
  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  let dataSize = 0;
  let dataOffset = 0;

  for (let offset = 36; offset < buffer.length - 8; offset++) {
    const chunkId = buffer.toString('utf8', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      dataSize = chunkSize;
      dataOffset = offset + 8;
      break;
    }

    offset += 8 + chunkSize - 1;
  }

  if (dataSize === 0 || dataOffset === 0) {
    throw new Error('No data chunk found in WAV file');
  }

  return { sampleRate, bitsPerSample, numChannels, dataSize, dataOffset, audioFormat };
}

/**
 * Reads a WAV file and yields AudioChunks at configurable intervals.
 * Simulates real-time delivery by waiting between chunks.
 *
 * @param filePath - Path to the WAV file
 * @param options - Configuration for chunk duration and speed multiplier
 */
export async function* readWavFile(
  filePath: string,
  options?: {
    chunkDurationMs?: number;
    speedMultiplier?: number;
  },
): AsyncIterable<AudioChunk> {
  const chunkDurationMs = options?.chunkDurationMs ?? 20;
  const speedMultiplier = options?.speedMultiplier ?? 1.0;

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fd = createReadStream(filePath, { highWaterMark: 44 });
  const headerChunks: Buffer[] = [];

  for await (const chunk of fd) {
    headerChunks.push(chunk as Buffer);
    const combined = Buffer.concat(headerChunks);
    if (combined.length >= 44) {
      break;
    }
  }

  fd.destroy();

  const headerBuffer = Buffer.concat(headerChunks).subarray(0, 44);
  const header = parseWavHeader(headerBuffer);

  const bytesPerSample = Math.floor(header.bitsPerSample / 8);
  const bytesPerFrame = bytesPerSample * header.numChannels;
  const framesPerChunk = Math.ceil((header.sampleRate / 1000) * chunkDurationMs);
  const bytesPerChunk = framesPerChunk * bytesPerFrame;

  const dataStream = createReadStream(filePath, {
    start: header.dataOffset,
    end: header.dataOffset + header.dataSize - 1,
    highWaterMark: bytesPerChunk,
  });

  let timestamp = Date.now();

  for await (const rawChunk of dataStream) {
    const buffer = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as ArrayBuffer);

    const encoding = header.bitsPerSample === 16 ? ('linear16' as const) : ('pcm' as const);

    const chunk: AudioChunk = {
      buffer,
      sampleRate: header.sampleRate,
      encoding,
      channels: header.numChannels,
      timestamp,
    };

    yield chunk;

    timestamp = Date.now();
    const waitMs = chunkDurationMs / speedMultiplier;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  dataStream.destroy();
}

/**
 * Writes an array of AudioChunks to a WAV file.
 * Assumes linear16 16-bit PCM encoding for all chunks.
 */
export async function writeWavFile(
  filePath: string,
  chunks: AudioChunk[],
  sampleRate?: number,
): Promise<void> {
  if (chunks.length === 0) {
    const emptyWav = createWavHeader(0, 0, sampleRate ?? 8000);
    await writeFile(filePath, emptyWav);
    return;
  }

  const firstChunk = chunks[0];
  if (!firstChunk) {
    const emptyWav = createWavHeader(0, 0, sampleRate ?? 8000);
    await writeFile(filePath, emptyWav);
    return;
  }
  const rate = sampleRate ?? firstChunk.sampleRate;
  const totalDataSize = chunks.reduce((sum, c) => sum + c.buffer.length, 0);

  const header = createWavHeader(totalDataSize, totalDataSize, rate);
  const headerBuffer = Buffer.from(header);
  const dataBuffers = chunks.map((c) => c.buffer);

  const combined = Buffer.concat([headerBuffer, ...dataBuffers]);
  await writeFile(filePath, new Uint8Array(combined));
}

function createWavHeader(dataSize: number, _fileSize: number, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44);
  const byteRate = sampleRate * 2;

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

/**
 * Captures microphone input and yields AudioChunks.
 * Attempts to use sox, arecord, or reads raw PCM from stdin.
 *
 * IMPORTANT: This requires external audio tools to be installed.
 * - macOS: brew install sox
 * - Linux: apt install sox or apt install alsa-utils
 */
export async function* captureMicrophone(options?: {
  sampleRate?: number;
  chunkDurationMs?: number;
  device?: string;
}): AsyncIterable<AudioChunk> {
  const sampleRate = options?.sampleRate ?? 8000;
  const chunkDurationMs = options?.chunkDurationMs ?? 20;
  const bytesPerChunk = Math.ceil((sampleRate / 1000) * chunkDurationMs) * 2;

  const streams = await tryMicStreams(sampleRate, options?.device);

  if (streams) {
    yield* streams;
    return;
  }

  yield* stdinCapture(sampleRate, bytesPerChunk);
}

async function tryMicStreams(
  sampleRate: number,
  device?: string,
): Promise<AsyncIterable<AudioChunk> | null> {
  const os = platform();

  if (os === 'darwin' || os === 'linux') {
    try {
      const args = [
        '-q',
        '-d',
        '-t',
        'raw',
        '-r',
        String(sampleRate),
        '-b',
        '16',
        '-c',
        '1',
        '-e',
        'signed-integer',
        '-',
      ];

      if (device) {
        if (os === 'darwin') {
          throw new Error(
            'Device selection not supported with sox on macOS. Use system audio settings.',
          );
        }
        args.unshift('-D', device);
      }

      return spawnCapture('sox', args, sampleRate);
    } catch {
      // Fall through to next option
    }
  }

  if (os === 'linux') {
    try {
      const args = ['-q', '-f', 'S16_LE', '-r', String(sampleRate), '-c', '1'];
      if (device) {
        args.push('-D', device);
      }

      return spawnCapture('arecord', args, sampleRate);
    } catch {
      // Fall through to stdin
    }
  }

  return null;
}

async function* spawnCapture(
  command: string,
  args: string[],
  sampleRate: number,
): AsyncIterable<AudioChunk> {
  const proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const stdout = proc.stdout;
  if (!stdout) {
    proc.kill();
    throw new Error(`Failed to spawn ${command}: no stdout stream`);
  }
  const readable = Readable.from(stdout);

  try {
    for await (const data of readable) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

      yield {
        buffer,
        sampleRate,
        encoding: 'linear16' as const,
        channels: 1,
        timestamp: Date.now(),
      };
    }
  } finally {
    proc.kill();

    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
  }
}

async function* stdinCapture(
  sampleRate: number,
  _bytesPerChunk: number,
): AsyncIterable<AudioChunk> {
  const os = platform();
  let hint = '';

  if (os === 'darwin') {
    hint = 'Install sox: brew install sox';
  } else if (os === 'linux') {
    hint = 'Install sox: apt install sox, or arecord: apt install alsa-utils';
  }

  if (hint) {
    process.stderr.write(
      `[simulator] No microphone tool detected. ${hint}\n[simulator] Reading raw 16-bit signed PCM from stdin (pipe audio with sox -d -t raw -r 8000 -b 16 -c 1 -e signed-integer - | ...)\n`,
    );
  }

  for await (const data of process.stdin) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

    yield {
      buffer,
      sampleRate,
      encoding: 'linear16' as const,
      channels: 1,
      timestamp: Date.now(),
    };
  }
}

/**
 * Plays TTS output audio chunks through the speakers.
 * Attempts to use sox or aplay/play command.
 */
export async function playAudio(
  chunks: AudioChunk[],
  options?: { sampleRate?: number },
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const sampleRate = options?.sampleRate ?? chunks[0]?.sampleRate ?? 8000;
  const totalBuffer = Buffer.concat(chunks.map((c) => c.buffer));

  const tmpFile = resolve(tmpdir(), `voice-agent-simulator-${Date.now()}.wav`);
  const header = createWavHeader(totalBuffer.length, totalBuffer.length, sampleRate);

  await writeFile(tmpFile, new Uint8Array(Buffer.concat([header, totalBuffer])));

  try {
    await playWavFile(tmpFile);
  } finally {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmpFile);
    } catch {
      // Best-effort cleanup
    }
  }
}

async function playWavFile(filePath: string): Promise<void> {
  const os = platform();
  let command: string;
  let args: string[];

  if (os === 'darwin') {
    command = 'afplay';
    args = [filePath];
  } else if (os === 'linux') {
    command = 'aplay';
    args = [filePath];
  } else {
    throw new Error(`Audio playback not supported on platform: ${os}`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'ignore',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to play audio: ${err.message}. Install sox: ${os === 'darwin' ? 'brew install sox' : 'apt install sox'}`,
        ),
      );
    });
  });
}
