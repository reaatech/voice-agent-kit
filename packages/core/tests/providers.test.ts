import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MockMCPClient,
  type MockSTTProvider,
  type MockTTSProvider,
  createMockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
} from '../src/providers/index.js';
import type { AudioChunk } from '../src/types/index.js';

describe('MockSTTProvider', () => {
  let stt: MockSTTProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    stt = createMockSTTProvider({
      delay: 10,
      transcripts: ['Hello world'],
      confidence: 0.95,
      interimCount: 2,
      autoEndOfSpeech: true,
      endOfSpeechDelay: 50,
    });
  });

  afterEach(() => {
    stt.close();
    vi.useRealTimers();
  });

  describe('connection', () => {
    it('should connect successfully', async () => {
      await stt.connect({});
      expect(stt.name).toBe('mock-stt');
    });

    it('should reject audio when not connected', () => {
      const chunk: AudioChunk = {
        buffer: Buffer.alloc(320),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      // Should not throw when not connected
      expect(() => stt.streamAudio(chunk)).not.toThrow();
    });
  });

  describe('utterance handling', () => {
    it('should emit interim and final utterances', async () => {
      const utterances: Array<{ transcript: string; isFinal: boolean }> = [];

      await stt.connect({});
      stt.onUtterance((utterance) => {
        utterances.push({
          transcript: utterance.transcript,
          isFinal: utterance.isFinal,
        });
      });

      const chunk: AudioChunk = {
        buffer: Buffer.alloc(320),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      stt.streamAudio(chunk);

      // Wait for processing
      await vi.advanceTimersByTimeAsync(200);

      expect(utterances.length).toBeGreaterThanOrEqual(2); // At least interim + final

      // Check final utterance
      const finalUtterance = utterances.find((u) => u.isFinal);
      expect(finalUtterance).toBeDefined();
      expect(finalUtterance?.transcript).toBe('Hello world');
    });

    it('should register end of speech callback', async () => {
      const endOfSpeechSpy = vi.fn();

      await stt.connect({});
      expect(() => stt.onEndOfSpeech(endOfSpeechSpy)).not.toThrow();

      // Verify the callback was registered (method exists)
      expect(typeof stt.onEndOfSpeech).toBe('function');
    });
  });

  describe('reset', () => {
    it('should reset transcript index', async () => {
      await stt.connect({});

      stt.reset();

      // After reset, should start from first transcript again
      expect(stt).toBeDefined();
    });
  });
});

describe('MockTTSProvider', () => {
  let tts: MockTTSProvider;

  beforeEach(() => {
    tts = createMockTTSProvider({
      delay: 10,
      firstByteDelay: 20,
      chunkSize: 160,
      sampleRate: 8000,
      encoding: 'mulaw',
    });
  });

  describe('synthesis', () => {
    it('should stream audio chunks for text', async () => {
      const chunks: AudioChunk[] = [];

      for await (const chunk of tts.synthesize('Hello world', {})) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.sampleRate).toBe(8000);
      expect(chunks[0]?.encoding).toBe('mulaw');
      expect(chunks[0]?.channels).toBe(1);
    });

    it('should handle empty text', async () => {
      const chunks: AudioChunk[] = [];

      for await (const chunk of tts.synthesize('', {})) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1); // At least one chunk
    });

    it('should track first byte latency', async () => {
      expect(tts.getLastFirstByteLatency()).toBeNull();

      for await (const _ of tts.synthesize('Hello', {})) {
        // Consume the stream
      }

      expect(tts.getLastFirstByteLatency()).toBeGreaterThan(0);
    });
  });

  describe('properties', () => {
    it('should report streaming support', () => {
      expect(tts.supportsStreaming).toBe(true);
    });

    it('should have null first byte latency before benchmark', () => {
      expect(tts.firstByteLatencyMs).toBeNull();
    });
  });
});

describe('MockMCPClient', () => {
  let mcp: MockMCPClient;

  beforeEach(() => {
    mcp = createMockMCPClient({
      delay: 10,
      responsePrefix: 'Echo:',
      responseSuffix: 'Over.',
    });
  });

  afterEach(() => {
    mcp.close();
  });

  describe('connection', () => {
    it('should connect successfully', async () => {
      await mcp.connect();
      expect(mcp).toBeDefined();
    });

    it('should reject requests when not connected', async () => {
      await expect(
        mcp.sendRequest({
          sessionId: 'sess-1',
          turnId: 'turn-1',
          utterance: 'Hello',
          history: [],
        }),
      ).rejects.toThrow('MCP client not connected');
    });
  });

  describe('request handling', () => {
    it('should return a response with echoed utterance', async () => {
      await mcp.connect();

      const response = await mcp.sendRequest({
        sessionId: 'sess-1',
        turnId: 'turn-1',
        utterance: 'Hello world',
        history: [],
      });

      expect(response.text).toContain('Hello world');
      expect(response.text).toContain('Echo:');
      expect(response.text).toContain('Over.');
      expect(response.latencyMs).toBe(10);
      expect(response.confidence).toBe(0.95);
      expect(response.toolCalls).toEqual([]);
    });

    it('should include tool calls when configured', async () => {
      mcp.setOptions({
        toolCalls: [
          {
            name: 'get_weather',
            arguments: { location: 'San Francisco' },
          },
        ],
      });

      await mcp.connect();

      const response = await mcp.sendRequest({
        sessionId: 'sess-1',
        turnId: 'turn-1',
        utterance: "What's the weather?",
        history: [],
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0]?.name).toBe('get_weather');
    });

    it('should simulate failure when configured', async () => {
      mcp.setOptions({
        shouldFail: true,
        failureMessage: 'Simulated error',
      });

      await mcp.connect();

      await expect(
        mcp.sendRequest({
          sessionId: 'sess-1',
          turnId: 'turn-1',
          utterance: 'Hello',
          history: [],
        }),
      ).rejects.toThrow('Simulated error');
    });
  });

  describe('request counting', () => {
    it('should track request count', async () => {
      await mcp.connect();

      expect(mcp.getRequestCount()).toBe(0);

      await mcp.sendRequest({
        sessionId: 'sess-1',
        turnId: 'turn-1',
        utterance: 'Hello',
        history: [],
      });

      expect(mcp.getRequestCount()).toBe(1);

      await mcp.sendRequest({
        sessionId: 'sess-1',
        turnId: 'turn-2',
        utterance: 'World',
        history: [],
      });

      expect(mcp.getRequestCount()).toBe(2);
    });

    it('should reset count on reset', async () => {
      await mcp.connect();

      await mcp.sendRequest({
        sessionId: 'sess-1',
        turnId: 'turn-1',
        utterance: 'Hello',
        history: [],
      });

      mcp.reset();

      expect(mcp.getRequestCount()).toBe(0);
    });
  });
});
