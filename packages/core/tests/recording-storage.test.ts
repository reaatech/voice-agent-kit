import { describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  writeSessionJson,
  writeTranscriptFile,
  writeWavFile,
} from '../src/recording/index.js';
import { FileSystemStorage } from '../src/recording/storage/filesystem-storage.js';
import { S3Storage } from '../src/recording/storage/s3-storage.js';
import type { AudioChunk, CallRecording, TurnRecord } from '../src/types/index.js';

function createRecording(sessionId: string, overrides: Partial<CallRecording> = {}): CallRecording {
  return {
    sessionId,
    callSid: `CA-${sessionId}`,
    startTime: 1000,
    audioChunks: [],
    turns: [],
    events: [],
    metadata: {},
    ...overrides,
  };
}

function createChunk(overrides: Partial<AudioChunk> = {}): AudioChunk {
  return {
    buffer: Buffer.from([0x7f, 0x7e, 0x7d, 0x7c]),
    sampleRate: 8000,
    encoding: 'mulaw',
    channels: 1,
    timestamp: 1000,
    ...overrides,
  };
}

function createLinear16Chunk(): AudioChunk {
  const buf = Buffer.alloc(4);
  buf.writeInt16LE(100, 0);
  buf.writeInt16LE(-200, 2);
  return {
    buffer: buf,
    sampleRate: 8000,
    encoding: 'linear16',
    channels: 1,
    timestamp: 1000,
  };
}

// ──────────────────────────────────────
// MemoryStorage
// ──────────────────────────────────────

describe('MemoryStorage', () => {
  it('should save and retrieve a recording', () => {
    const storage = new MemoryStorage();
    const recording = createRecording('session-1');

    const uri = storage.save(recording);
    expect(uri).toBe('memory://session-1');

    const retrieved = storage.get('session-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.sessionId).toBe('session-1');
    expect(retrieved?.callSid).toBe('CA-session-1');
  });

  it('should return undefined for non-existent recording', () => {
    const storage = new MemoryStorage();
    expect(storage.get('non-existent')).toBeUndefined();
  });

  it('should return all recordings', () => {
    const storage = new MemoryStorage();
    storage.save(createRecording('session-1'));
    storage.save(createRecording('session-2'));

    const all = storage.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('should delete a recording', () => {
    const storage = new MemoryStorage();
    storage.save(createRecording('session-1'));

    const deleted = storage.delete('session-1');
    expect(deleted).toBe(true);
    expect(storage.get('session-1')).toBeUndefined();
  });

  it('should return false when deleting non-existent recording', () => {
    const storage = new MemoryStorage();
    expect(storage.delete('non-existent')).toBe(false);
  });

  it('should clear all recordings', () => {
    const storage = new MemoryStorage();
    storage.save(createRecording('session-1'));
    storage.save(createRecording('session-2'));

    storage.clear();
    expect(storage.count()).toBe(0);
    expect(storage.getAll()).toHaveLength(0);
  });

  it('should count recordings', () => {
    const storage = new MemoryStorage();
    expect(storage.count()).toBe(0);

    storage.save(createRecording('session-1'));
    expect(storage.count()).toBe(1);

    storage.save(createRecording('session-2'));
    expect(storage.count()).toBe(2);
  });

  it('should evict oldest recording when exceeding maxRecordings', () => {
    const storage = new MemoryStorage({ maxRecordings: 2 });
    storage.save(createRecording('session-1'));
    storage.save(createRecording('session-2'));
    storage.save(createRecording('session-3'));

    expect(storage.count()).toBe(2);
    expect(storage.get('session-1')).toBeUndefined();
    expect(storage.get('session-2')).toBeDefined();
    expect(storage.get('session-3')).toBeDefined();
  });

  it('should evict in FIFO order', () => {
    const storage = new MemoryStorage({ maxRecordings: 3 });
    storage.save(createRecording('session-1'));
    storage.save(createRecording('session-2'));
    storage.save(createRecording('session-3'));
    storage.save(createRecording('session-4'));

    expect(storage.get('session-1')).toBeUndefined();
    expect(storage.get('session-2')).toBeDefined();
    expect(storage.get('session-3')).toBeDefined();
    expect(storage.get('session-4')).toBeDefined();
  });

  it('should use default maxRecordings of 100', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 100; i++) {
      storage.save(createRecording(`session-${i}`));
    }
    expect(storage.count()).toBe(100);

    storage.save(createRecording('overflow'));
    expect(storage.count()).toBe(100);
    expect(storage.get('session-0')).toBeUndefined();
  });
});

// ──────────────────────────────────────
// WAV Writer
// ──────────────────────────────────────

describe('writeWavFile', () => {
  it('should return a valid WAV header with empty chunks', () => {
    const result = writeWavFile([]);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThanOrEqual(44);

    expect(result.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.toString('ascii', 8, 12)).toBe('WAVE');
    expect(result.toString('ascii', 12, 16)).toBe('fmt ');
    expect(result.toString('ascii', 36, 40)).toBe('data');

    const dataSize = result.readUInt32LE(40);
    expect(dataSize).toBe(0);
  });

  it('should return header-only WAV with custom sample rate for empty chunks', () => {
    const result = writeWavFile([], 16000);

    expect(result.readUInt32LE(24)).toBe(16000);
    expect(result.readUInt16LE(22)).toBe(1);
    expect(result.readUInt16LE(34)).toBe(16);
  });

  it('should write mulaw chunk as linear16 PCM data', () => {
    const chunk = createChunk({ buffer: Buffer.from([0x7f, 0x00, 0xff]) });
    const result = writeWavFile([chunk]);

    expect(result.length).toBeGreaterThan(44);
    const dataSize = result.readUInt32LE(40);
    expect(dataSize).toBe(6);
    expect(result.readUInt32LE(24)).toBe(8000);

    const sample1 = result.readInt16LE(44);
    const sample2 = result.readInt16LE(46);
    const sample3 = result.readInt16LE(48);

    expect(typeof sample1).toBe('number');
    expect(typeof sample2).toBe('number');
    expect(typeof sample3).toBe('number');
  });

  it('should write linear16 chunk verbatim', () => {
    const chunk = createLinear16Chunk();
    const result = writeWavFile([chunk]);

    const dataSize = result.readUInt32LE(40);
    expect(dataSize).toBe(4);

    expect(result.readInt16LE(44)).toBe(100);
    expect(result.readInt16LE(46)).toBe(-200);
  });

  it('should write pcm encoded chunk', () => {
    const buf = Buffer.alloc(4);
    buf.writeInt16LE(50, 0);
    buf.writeInt16LE(150, 2);
    const chunk: AudioChunk = {
      buffer: buf,
      sampleRate: 8000,
      encoding: 'pcm',
      channels: 1,
      timestamp: 1000,
    };

    const result = writeWavFile([chunk]);
    expect(result.readInt16LE(44)).toBe(50);
    expect(result.readInt16LE(46)).toBe(150);
  });

  it('should concatenate multiple chunks', () => {
    const chunk1 = createLinear16Chunk();
    const buf2 = Buffer.alloc(4);
    buf2.writeInt16LE(300, 0);
    buf2.writeInt16LE(-400, 2);
    const chunk2: AudioChunk = { ...chunk1, buffer: buf2 };

    const result = writeWavFile([chunk1, chunk2]);

    const dataSize = result.readUInt32LE(40);
    expect(dataSize).toBe(8);

    expect(result.readInt16LE(44)).toBe(100);
    expect(result.readInt16LE(46)).toBe(-200);
    expect(result.readInt16LE(48)).toBe(300);
    expect(result.readInt16LE(50)).toBe(-400);
  });

  it('should preserve sample rate from first chunk', () => {
    const chunk = createChunk({ sampleRate: 44100 });
    const result = writeWavFile([chunk]);

    expect(result.readUInt32LE(24)).toBe(44100);
  });

  it('should set correct format parameters', () => {
    const chunk = createChunk({ channels: 2 });
    const result = writeWavFile([chunk]);

    expect(result.readUInt16LE(20)).toBe(1);
    expect(result.readUInt16LE(22)).toBe(2);
    expect(result.readUInt16LE(34)).toBe(16);
  });

  it('should handle chunks with different sample rates', () => {
    const chunk1 = createLinear16Chunk();
    const buf2 = Buffer.alloc(4);
    buf2.writeInt16LE(300, 0);
    buf2.writeInt16LE(-400, 2);
    const chunk2: AudioChunk = {
      buffer: buf2,
      sampleRate: 16000,
      encoding: 'linear16',
      channels: 1,
      timestamp: 1001,
    };

    const result = writeWavFile([chunk1, chunk2]);

    expect(result.readUInt32LE(24)).toBe(8000);
    expect(result.readUInt32LE(40)).toBeGreaterThan(0);
  });

  it('should handle empty array gracefully', () => {
    const result = writeWavFile([]);
    expect(result.readUInt32LE(40)).toBe(0);
  });
});

// ──────────────────────────────────────
// Transcript Writer
// ──────────────────────────────────────

describe('writeTranscriptFile', () => {
  it('should produce markdown with header', () => {
    const turns: TurnRecord[] = [
      {
        turnId: 'turn-1',
        userUtterance: 'Hello',
        agentResponse: 'Hi there!',
        startTime: 1000,
        endTime: 2000,
        latencyMs: 100,
      },
    ];

    const result = writeTranscriptFile(turns);
    expect(result).toContain('# Call Transcript');
    expect(result).toContain('## Turn turn-1');
    expect(result).toContain('**User**: Hello');
    expect(result).toContain('**Agent**: Hi there!');
    expect(result).toContain('Latency: 100ms');
  });

  it('should include tool calls when present', () => {
    const turns: TurnRecord[] = [
      {
        turnId: 'turn-1',
        userUtterance: 'What is the weather?',
        agentResponse: 'It is sunny.',
        startTime: 1000,
        latencyMs: 200,
        toolCalls: [{ name: 'get_weather', arguments: { city: 'NYC' }, result: { temp: 72 } }],
      },
    ];

    const result = writeTranscriptFile(turns);
    expect(result).toContain('### Tool Calls');
    expect(result).toContain('`get_weather`');
    expect(result).toContain('"temp":72');
  });

  it('should include cost information when present', () => {
    const turns: TurnRecord[] = [
      {
        turnId: 'turn-1',
        userUtterance: 'Hi',
        agentResponse: 'Hello',
        startTime: 1000,
        latencyMs: 50,
        cost: {
          sttCost: 0.001,
          ttsCost: 0.002,
          mcpCost: 0.003,
          totalCost: 0.006,
          currency: 'USD',
        },
      },
    ];

    const result = writeTranscriptFile(turns);
    expect(result).toContain('USD 0.006000');
  });

  it('should handle empty turns array', () => {
    const result = writeTranscriptFile([]);
    expect(result).toContain('# Call Transcript');
  });
});

// ──────────────────────────────────────
// Session JSON Writer
// ──────────────────────────────────────

describe('writeSessionJson', () => {
  it('should produce valid JSON', () => {
    const recording = createRecording('session-1');

    const result = writeSessionJson(recording);
    expect(() => JSON.parse(result)).not.toThrow();

    const parsed = JSON.parse(result);
    expect(parsed.sessionId).toBe('session-1');
    expect(parsed.callSid).toBe('CA-session-1');
  });

  it('should include turns with audio frame counts', () => {
    const recording = createRecording('session-1', {
      turns: [
        {
          turnId: 'turn-1',
          userUtterance: 'hello',
          agentResponse: 'hi',
          startTime: 1000,
          endTime: 2000,
          latencyMs: 100,
          userAudio: [createChunk(), createChunk()],
          agentAudio: [createChunk()],
        },
      ],
    });

    const result = JSON.parse(writeSessionJson(recording));
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].userAudioFrames).toBe(2);
    expect(result.turns[0].agentAudioFrames).toBe(1);
  });

  it('should include events with data', () => {
    const recording = createRecording('session-1', {
      events: [
        {
          type: 'pipeline:start',
          sessionId: 'session-1',
          timestamp: 1000,
          data: { stage: 'init' },
        },
      ],
    });

    const result = JSON.parse(writeSessionJson(recording));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('pipeline:start');
    expect(result.events[0].data.stage).toBe('init');
  });

  it('should include metadata', () => {
    const recording = createRecording('session-1', {
      metadata: { caller: 'John', region: 'us-east' },
    });

    const result = JSON.parse(writeSessionJson(recording));
    expect(result.metadata).toEqual({ caller: 'John', region: 'us-east' });
  });
});

// ──────────────────────────────────────
// FileSystemStorage
// ──────────────────────────────────────

describe('FileSystemStorage', () => {
  it('should construct with directory option', () => {
    const storage = new FileSystemStorage({ directory: '/tmp/test-recordings' });
    expect(storage).toBeDefined();
  });

  it('should return undefined from getMeta for non-existent session', async () => {
    const storage = new FileSystemStorage({ directory: '/tmp/non-existent-dir' });

    const meta = await storage.getMeta('non-existent-session');
    expect(meta).toBeUndefined();
  });
});

// ──────────────────────────────────────
// S3Storage
// ──────────────────────────────────────

describe('S3Storage', () => {
  it('should construct with bucket option', () => {
    const storage = new S3Storage({ bucket: 'test-bucket' });
    expect(storage).toBeDefined();
  });

  it('should return undefined from getMeta when S3 client unavailable', async () => {
    const storage = new S3Storage({ bucket: 'test-bucket' });

    const meta = await storage.getMeta('non-existent-session');
    expect(meta).toBeUndefined();
  });
});
