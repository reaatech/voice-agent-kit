import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingManager } from '../src/recording/index.js';
import type {
  AudioChunk,
  CallRecording,
  PipelineEvent,
  RecordingConfig,
  TurnRecord,
} from '../src/types/index.js';

function createChunk(overrides: Partial<AudioChunk> = {}): AudioChunk {
  return {
    buffer: Buffer.from([0x7f, 0x7e, 0x7d]),
    sampleRate: 8000,
    encoding: 'mulaw',
    channels: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createTurn(turnId: string): TurnRecord {
  return {
    turnId,
    userUtterance: 'hello',
    agentResponse: 'hi there',
    startTime: Date.now(),
    latencyMs: 100,
  };
}

function createEvent(sessionId: string, type: string): PipelineEvent {
  return {
    type: type as PipelineEvent['type'],
    sessionId,
    timestamp: Date.now(),
  };
}

describe('RecordingManager', () => {
  let manager: RecordingManager;
  let config: RecordingConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      storage: 'memory',
    };
    manager = new RecordingManager(config);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('constructor', () => {
    it('should create a recording manager instance', () => {
      expect(manager).toBeInstanceOf(RecordingManager);
      expect(manager.isEnabled()).toBe(true);
    });

    it('should create with filesystem storage when configured', () => {
      const fsManager = new RecordingManager({
        enabled: true,
        storage: 'filesystem',
        directory: '/tmp/test-recordings',
      });
      expect(fsManager).toBeInstanceOf(RecordingManager);
      fsManager.destroy();
    });

    it('should create with s3 storage when configured', () => {
      const s3Manager = new RecordingManager({
        enabled: true,
        storage: 's3',
        s3Bucket: 'test-bucket',
      });
      expect(s3Manager).toBeInstanceOf(RecordingManager);
      s3Manager.destroy();
    });
  });

  describe('startRecording', () => {
    it('should start a new recording', () => {
      manager.startRecording('session-1', 'CA123');

      const recording = manager.getRecording('session-1');
      expect(recording).toBeDefined();
      expect(recording!.sessionId).toBe('session-1');
      expect(recording!.callSid).toBe('CA123');
      expect(recording!.startTime).toBeGreaterThan(0);
      expect(recording!.audioChunks).toEqual([]);
      expect(recording!.turns).toEqual([]);
      expect(recording!.events).toEqual([]);
      expect(recording!.metadata).toEqual({});
    });

    it('should accept optional metadata', () => {
      manager.startRecording('session-1', 'CA123', { callerName: 'John', region: 'us-east' });

      const recording = manager.getRecording('session-1');
      expect(recording!.metadata).toEqual({ callerName: 'John', region: 'us-east' });
    });

    it('should emit recording:started event', () => {
      const handler = vi.fn();
      manager.on('recording:started', handler);

      manager.startRecording('session-1', 'CA123');

      expect(handler).toHaveBeenCalledWith({ sessionId: 'session-1', callSid: 'CA123' });
    });

    it('should not start recording when disabled', () => {
      const disabledManager = new RecordingManager({ enabled: false, storage: 'memory' });
      disabledManager.startRecording('session-1', 'CA123');

      const recording = disabledManager.getRecording('session-1');
      expect(recording).toBeUndefined();
      disabledManager.destroy();
    });

    it('should not overwrite an existing active recording', () => {
      manager.startRecording('session-1', 'CA123');
      manager.startRecording('session-1', 'CA456');

      const recording = manager.getRecording('session-1');
      expect(recording!.callSid).toBe('CA123');
    });
  });

  describe('recordAudioChunk', () => {
    it('should record an inbound audio chunk', () => {
      manager.startRecording('session-1', 'CA123');
      const chunk = createChunk();

      manager.recordAudioChunk('session-1', chunk, 'inbound');

      const recording = manager.getRecording('session-1');
      expect(recording!.audioChunks).toHaveLength(1);
      expect(recording!.audioChunks[0]).toBe(chunk);
    });

    it('should record an outbound audio chunk', () => {
      manager.startRecording('session-1', 'CA123');
      const chunk = createChunk();

      manager.recordAudioChunk('session-1', chunk, 'outbound');

      const recording = manager.getRecording('session-1');
      expect(recording!.audioChunks).toHaveLength(1);
    });

    it('should record multiple chunks', () => {
      manager.startRecording('session-1', 'CA123');

      manager.recordAudioChunk('session-1', createChunk(), 'inbound');
      manager.recordAudioChunk('session-1', createChunk(), 'inbound');
      manager.recordAudioChunk('session-1', createChunk(), 'inbound');

      const recording = manager.getRecording('session-1');
      expect(recording!.audioChunks).toHaveLength(3);
    });

    it('should emit recording:audio event', () => {
      const handler = vi.fn();
      manager.on('recording:audio', handler);
      manager.startRecording('session-1', 'CA123');

      const chunk = createChunk();
      manager.recordAudioChunk('session-1', chunk, 'inbound');

      expect(handler).toHaveBeenCalledWith({
        sessionId: 'session-1',
        direction: 'inbound',
        chunkSize: chunk.buffer.length,
      });
    });

    it('should silently ignore non-existent session', () => {
      const chunk = createChunk();
      expect(() => {
        manager.recordAudioChunk('non-existent', chunk, 'inbound');
      }).not.toThrow();
    });

    it('should not store audio when saveAudio is false', () => {
      const noAudioManager = new RecordingManager({
        enabled: true,
        storage: 'memory',
        saveAudio: false,
      });
      noAudioManager.startRecording('session-1', 'CA123');

      noAudioManager.recordAudioChunk('session-1', createChunk(), 'inbound');

      const recording = noAudioManager.getRecording('session-1');
      expect(recording!.audioChunks).toHaveLength(0);
      noAudioManager.destroy();
    });
  });

  describe('recordTurn', () => {
    it('should record a turn', () => {
      manager.startRecording('session-1', 'CA123');
      const turn = createTurn('turn-1');

      manager.recordTurn('session-1', turn);

      const recording = manager.getRecording('session-1');
      expect(recording!.turns).toHaveLength(1);
      expect(recording!.turns[0]).toBe(turn);
    });

    it('should record multiple turns', () => {
      manager.startRecording('session-1', 'CA123');

      manager.recordTurn('session-1', createTurn('turn-1'));
      manager.recordTurn('session-1', createTurn('turn-2'));

      const recording = manager.getRecording('session-1');
      expect(recording!.turns).toHaveLength(2);
    });

    it('should emit recording:turn event', () => {
      const handler = vi.fn();
      manager.on('recording:turn', handler);
      manager.startRecording('session-1', 'CA123');

      manager.recordTurn('session-1', createTurn('turn-1'));

      expect(handler).toHaveBeenCalledWith({
        sessionId: 'session-1',
        turnId: 'turn-1',
      });
    });

    it('should silently ignore non-existent session', () => {
      expect(() => {
        manager.recordTurn('non-existent', createTurn('turn-1'));
      }).not.toThrow();
    });
  });

  describe('recordEvent', () => {
    it('should record a pipeline event', () => {
      manager.startRecording('session-1', 'CA123');
      const event = createEvent('session-1', 'pipeline:start');

      manager.recordEvent('session-1', event);

      const recording = manager.getRecording('session-1');
      expect(recording!.events).toHaveLength(1);
      expect(recording!.events[0]).toBe(event);
    });

    it('should silently ignore non-existent session', () => {
      expect(() => {
        manager.recordEvent('non-existent', createEvent('non-existent', 'pipeline:start'));
      }).not.toThrow();
    });

    it('should not store events when saveEvents is false', () => {
      const noEventsManager = new RecordingManager({
        enabled: true,
        storage: 'memory',
        saveEvents: false,
      });
      noEventsManager.startRecording('session-1', 'CA123');

      noEventsManager.recordEvent('session-1', createEvent('session-1', 'pipeline:start'));

      const recording = noEventsManager.getRecording('session-1');
      expect(recording!.events).toHaveLength(0);
      noEventsManager.destroy();
    });
  });

  describe('stopRecording', () => {
    it('should stop a recording and return CallRecording', async () => {
      manager.startRecording('session-1', 'CA123');
      manager.recordTurn('session-1', createTurn('turn-1'));

      const recording = await manager.stopRecording('session-1');

      expect(recording.sessionId).toBe('session-1');
      expect(recording.callSid).toBe('CA123');
      expect(recording.endTime).toBeGreaterThan(0);
      expect(recording.duration).toBeGreaterThanOrEqual(0);
      expect(recording.turns).toHaveLength(1);
    });

    it('should emit recording:stopped event', async () => {
      const handler = vi.fn();
      manager.on('recording:stopped', handler);
      manager.startRecording('session-1', 'CA123');

      await manager.stopRecording('session-1');

      expect(handler).toHaveBeenCalledWith({
        sessionId: 'session-1',
        duration: expect.any(Number),
        turns: 0,
      });
    });

    it('should move recording from active to completed', async () => {
      manager.startRecording('session-1', 'CA123');
      await manager.stopRecording('session-1');

      expect(manager.getRecording('session-1')).toBeDefined();
    });

    it('should throw for non-existent session', async () => {
      await expect(manager.stopRecording('non-existent')).rejects.toThrow(
        'No active recording found for session: non-existent',
      );
    });

    it('should set correct duration', async () => {
      const startTime = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(startTime);

      const timeManager = new RecordingManager({ enabled: true, storage: 'memory' });
      timeManager.startRecording('session-1', 'CA123');

      vi.advanceTimersByTime(1500);

      const recording = await timeManager.stopRecording('session-1');

      expect(recording.duration).toBe(1500);
      expect(recording.endTime).toBe(startTime + 1500);

      timeManager.destroy();
      vi.useRealTimers();
    });
  });

  describe('getRecording', () => {
    it('should return undefined for non-existent session', () => {
      expect(manager.getRecording('non-existent')).toBeUndefined();
    });

    it('should return active recording', () => {
      manager.startRecording('session-1', 'CA123');
      expect(manager.getRecording('session-1')).toBeDefined();
    });

    it('should return completed recording after stop', async () => {
      manager.startRecording('session-1', 'CA123');
      await manager.stopRecording('session-1');

      const recording = manager.getRecording('session-1');
      expect(recording).toBeDefined();
      expect(recording!.endTime).toBeDefined();
    });
  });

  describe('getAllRecordings', () => {
    it('should return all active recordings', () => {
      manager.startRecording('session-1', 'CA123');
      manager.startRecording('session-2', 'CA456');

      const all = manager.getAllRecordings();
      expect(all).toHaveLength(2);
    });

    it('should return active and completed recordings', async () => {
      manager.startRecording('session-1', 'CA123');
      manager.startRecording('session-2', 'CA456');
      await manager.stopRecording('session-1');

      const all = manager.getAllRecordings();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no recordings', () => {
      expect(manager.getAllRecordings()).toEqual([]);
    });
  });

  describe('multiple concurrent recordings', () => {
    it('should handle multiple concurrent recordings independently', () => {
      manager.startRecording('session-1', 'CA123');
      manager.startRecording('session-2', 'CA456');

      const chunk1 = createChunk({ timestamp: 100 });
      const chunk2 = createChunk({ timestamp: 200 });

      manager.recordAudioChunk('session-1', chunk1, 'inbound');
      manager.recordAudioChunk('session-2', chunk2, 'outbound');

      manager.recordTurn('session-1', createTurn('turn-1'));

      const r1 = manager.getRecording('session-1')!;
      const r2 = manager.getRecording('session-2')!;

      expect(r1.audioChunks).toHaveLength(1);
      expect(r1.audioChunks[0].timestamp).toBe(100);
      expect(r1.turns).toHaveLength(1);

      expect(r2.audioChunks).toHaveLength(1);
      expect(r2.audioChunks[0].timestamp).toBe(200);
      expect(r2.turns).toHaveLength(0);
    });

    it('should stop recordings independently', async () => {
      manager.startRecording('session-1', 'CA123');
      manager.startRecording('session-2', 'CA456');

      await manager.stopRecording('session-1');

      expect(manager.getRecording('session-1')).toBeDefined();
      expect(manager.getRecording('session-2')).toBeDefined();

      const all = manager.getAllRecordings();
      expect(all).toHaveLength(2);
    });
  });

  describe('recording with no audio chunks', () => {
    it('should stop cleanly when no audio was recorded', async () => {
      manager.startRecording('session-1', 'CA123');

      const recording = await manager.stopRecording('session-1');

      expect(recording.audioChunks).toHaveLength(0);
      expect(recording.turns).toHaveLength(0);
      expect(recording.events).toHaveLength(0);
      expect(recording.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('saveToFile / saveToS3', () => {
    it('should provide saveToFile method', () => {
      expect(manager.saveToFile).toBeInstanceOf(Function);
    });

    it('should provide saveToS3 method', () => {
      expect(manager.saveToS3).toBeInstanceOf(Function);
    });
  });

  describe('destroy', () => {
    it('should clear all recordings and listeners', () => {
      manager.startRecording('session-1', 'CA123');
      const handler = vi.fn();
      manager.on('recording:started', handler);

      manager.destroy();

      expect(manager.getAllRecordings()).toHaveLength(0);
      expect(manager.listenerCount('recording:started')).toBe(0);
    });
  });
});
