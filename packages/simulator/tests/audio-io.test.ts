import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AudioChunk } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readWavFile, writeWavFile } from '../src/audio-io.js';

function chunk(buffer: Buffer, sampleRate = 16000): AudioChunk {
  return {
    buffer,
    sampleRate,
    encoding: 'linear16',
    channels: 1,
    timestamp: Date.now(),
  };
}

async function collect(filePath: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of readWavFile(filePath, { chunkDurationMs: 1, speedMultiplier: 1000 })) {
    parts.push(c.buffer);
  }
  return Buffer.concat(parts);
}

describe('WAV round-trip', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sim-wav-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('preserves PCM data through write then read', async () => {
    const file = join(dir, 'roundtrip.wav');
    // 100 16-bit samples (200 bytes) of a simple ramp.
    const pcm = Buffer.alloc(200);
    for (let i = 0; i < 100; i++) {
      pcm.writeInt16LE(((i * 300) % 30000) - 15000, i * 2);
    }

    await writeWavFile(file, [chunk(pcm, 16000)], 16000);
    const read = await collect(file);

    expect(read.length).toBe(pcm.length);
    expect(read.equals(pcm)).toBe(true);
  });

  it('preserves the sample rate in the header', async () => {
    const file = join(dir, 'rate.wav');
    await writeWavFile(file, [chunk(Buffer.alloc(40), 8000)], 8000);

    const first = (
      await readWavFile(file, { speedMultiplier: 1000 })[Symbol.asyncIterator]().next()
    ).value as AudioChunk;
    expect(first.sampleRate).toBe(8000);
  });

  it('writes a header-only WAV when given no chunks', async () => {
    const file = join(dir, 'empty.wav');
    await writeWavFile(file, [], 16000);

    const bytes = await readFile(file);
    expect(bytes.length).toBe(44); // 44-byte RIFF/WAVE header, no data
    expect(bytes.toString('utf8', 0, 4)).toBe('RIFF');
  });
});
