import type { AudioChunk } from '@reaatech/voice-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-transcribe-streaming', () => ({
  TranscribeStreamingClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      TranscriptResultStream: (async function* () {
        yield {
          TranscriptResult: {
            Transcripts: [
              {
                Alternatives: [{ Transcript: 'hello world', Confidence: 0.95 }],
                IsPartial: false,
              },
            ],
          },
        };
      })(),
    }),
    destroy: vi.fn(),
  })),
  StartStreamTranscriptionCommand: vi.fn(),
  MediaEncoding: { PCM: 'pcm' },
}));

vi.mock('@aws-sdk/credential-provider-ini', () => ({
  fromIni: vi.fn().mockReturnValue({}),
}));

describe('AWSTranscribeProvider', () => {
  let provider: any;
  let AWSTranscribeProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/adapters/aws-transcribe.js');
    AWSTranscribeProvider = mod.AWSTranscribeProvider;
    provider = new AWSTranscribeProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('constructor', () => {
    it('should set default options', () => {
      expect(provider.name).toBe('aws-transcribe');
      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should throw without credentials', async () => {
      await expect(
        provider.connect({
          provider: 'aws-transcribe',
          sampleRate: 8000,
        }),
      ).rejects.toThrow('AWS credentials are required');
    });

    it('should connect with API key', async () => {
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-key');
      await provider.connect({
        provider: 'aws-transcribe',
        apiKey: 'access-key',
        region: 'us-west-2',
        sampleRate: 8000,
      });
      expect(provider.isConnected()).toBe(true);
      vi.unstubAllEnvs();
    });

    it('should connect using env vars without explicit API key', async () => {
      vi.stubEnv('AWS_ACCESS_KEY_ID', 'env-access-key');
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'env-secret-key');

      await provider.connect({
        provider: 'aws-transcribe',
        region: 'us-east-1',
        sampleRate: 8000,
      });

      expect(provider.isConnected()).toBe(true);
      vi.unstubAllEnvs();
    });
  });

  describe('transcription stream', () => {
    it('should emit utterance from stream events', async () => {
      const utteranceCb = vi.fn();
      const endOfSpeechCb = vi.fn();
      provider.onUtterance(utteranceCb);
      provider.onEndOfSpeech(endOfSpeechCb);

      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-key');
      await provider.connect({
        provider: 'aws-transcribe',
        apiKey: 'access-key',
        region: 'us-west-2',
        sampleRate: 8000,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(utteranceCb).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: 'hello world',
          confidence: 0.95,
          isFinal: true,
        }),
      );
      expect(endOfSpeechCb).toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  describe('streamAudio', () => {
    it('should emit error for invalid chunk', () => {
      const errorCb = vi.fn();
      provider.onError(errorCb);

      provider.streamAudio({
        buffer: 'invalid' as unknown as Buffer,
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      });

      expect(errorCb).toHaveBeenCalledWith(new Error('Invalid audio chunk'));
    });

    it('should queue audio when not connected', () => {
      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      };

      provider.streamAudio(chunk);
      expect(provider.audioQueue.length).toBe(1);
    });

    it('should push to audio input queue when connected', async () => {
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-key');
      await provider.connect({
        provider: 'aws-transcribe',
        apiKey: 'access-key',
        region: 'us-west-2',
        sampleRate: 8000,
      });

      const chunk: AudioChunk = {
        buffer: Buffer.from([0x00, 0x01]),
        sampleRate: 8000,
        encoding: 'linear16',
        channels: 1,
        timestamp: Date.now(),
      };

      provider.streamAudio(chunk);
      expect(provider.audioInputQueue.length).toBe(1);
      vi.unstubAllEnvs();
    });

    it('should convert mulaw to linear16 on the fly', async () => {
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-key');
      await provider.connect({
        provider: 'aws-transcribe',
        apiKey: 'access-key',
        region: 'us-west-2',
        sampleRate: 8000,
      });

      const chunk: AudioChunk = {
        buffer: Buffer.from([0xff, 0xff]),
        sampleRate: 8000,
        encoding: 'mulaw',
        channels: 1,
        timestamp: Date.now(),
      };

      provider.streamAudio(chunk);
      expect(provider.audioInputQueue.length).toBe(1);
      expect(provider.audioInputQueue[0].length).toBe(4);
      vi.unstubAllEnvs();
    });
  });

  describe('close', () => {
    it('should clean up state', async () => {
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-key');
      await provider.connect({
        provider: 'aws-transcribe',
        apiKey: 'access-key',
        region: 'us-west-2',
        sampleRate: 8000,
      });

      await provider.close();
      expect(provider.isConnected()).toBe(false);
      expect(provider.client).toBeNull();
      vi.unstubAllEnvs();
    });
  });

  describe('factory function', () => {
    it('should create provider via createAWSTranscribeProvider', async () => {
      const { createAWSTranscribeProvider } = await import('../src/adapters/aws-transcribe.js');
      const p = createAWSTranscribeProvider({ region: 'eu-west-1' });
      expect(p).toBeDefined();
      expect(p.name).toBe('aws-transcribe');
      await p.close();
    });
  });

  describe('callback registration', () => {
    it('should register utterance callback', () => {
      const cb = vi.fn();
      provider.onUtterance(cb);
      provider.emit('utterance', {
        transcript: 'test',
        confidence: 0.9,
        isFinal: true,
        timestamp: Date.now(),
      });
      expect(cb).toHaveBeenCalled();
    });

    it('should register endOfSpeech callback', () => {
      const cb = vi.fn();
      provider.onEndOfSpeech(cb);
      provider.emit('endOfSpeech');
      expect(cb).toHaveBeenCalled();
    });

    it('should register error callback', () => {
      const cb = vi.fn();
      provider.onError(cb);
      provider.emit('error', new Error('test'));
      expect(cb).toHaveBeenCalled();
    });
  });
});
