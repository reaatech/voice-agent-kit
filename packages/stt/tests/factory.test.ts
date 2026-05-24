import { describe, expect, it } from 'vitest';
import { AssemblyAIProvider } from '../src/adapters/assemblyai.js';
import { AWSTranscribeProvider } from '../src/adapters/aws-transcribe.js';
import { DeepgramSTTProvider } from '../src/adapters/deepgram.js';
import { GoogleCloudSTTProvider } from '../src/adapters/google-cloud-stt.js';
import { GroqWhisperSTTProvider } from '../src/adapters/groq-whisper.js';
import { OpenAIRealtimeSTTProvider } from '../src/adapters/openai-realtime.js';
import { OpenAIWhisperSTTProvider } from '../src/adapters/openai-whisper.js';
import { createSTTProvider } from '../src/factory.js';

describe('STT Provider Factory', () => {
  it('should create a DeepgramSTTProvider', () => {
    const provider = createSTTProvider({
      provider: 'deepgram',
      config: { provider: 'deepgram', sampleRate: 8000 },
    });
    expect(provider).toBeInstanceOf(DeepgramSTTProvider);
    expect(provider.name).toBe('deepgram');
  });

  it('should create an AssemblyAIProvider', () => {
    const provider = createSTTProvider({
      provider: 'assemblyai',
      config: { provider: 'assemblyai', sampleRate: 16000 },
    });
    expect(provider).toBeInstanceOf(AssemblyAIProvider);
    expect(provider.name).toBe('assemblyai');
  });

  it('should create an AWSTranscribeProvider', () => {
    const provider = createSTTProvider({
      provider: 'aws-transcribe',
      config: { provider: 'aws-transcribe', sampleRate: 8000 },
    });
    expect(provider).toBeInstanceOf(AWSTranscribeProvider);
    expect(provider.name).toBe('aws-transcribe');
  });

  it('should create a GoogleCloudSTTProvider', () => {
    const provider = createSTTProvider({
      provider: 'google-cloud-stt',
      config: { provider: 'google-cloud-stt', sampleRate: 8000 },
    });
    expect(provider).toBeInstanceOf(GoogleCloudSTTProvider);
    expect(provider.name).toBe('google-cloud-stt');
  });

  it('should create a GroqWhisperSTTProvider', () => {
    const provider = createSTTProvider({
      provider: 'groq-whisper',
      config: { provider: 'groq-whisper', sampleRate: 16000 },
    });
    expect(provider).toBeInstanceOf(GroqWhisperSTTProvider);
    expect(provider.name).toBe('groq-whisper');
  });

  it('should create an OpenAIRealtimeSTTProvider', () => {
    const provider = createSTTProvider({
      provider: 'openai-realtime',
      config: { provider: 'openai-realtime', sampleRate: 24000 },
    });
    expect(provider).toBeInstanceOf(OpenAIRealtimeSTTProvider);
    expect(provider.name).toBe('openai-realtime');
  });

  it('should create an OpenAIWhisperSTTProvider', () => {
    const provider = createSTTProvider({
      provider: 'openai-whisper',
      config: { provider: 'openai-whisper', sampleRate: 16000 },
    });
    expect(provider).toBeInstanceOf(OpenAIWhisperSTTProvider);
    expect(provider.name).toBe('openai-whisper');
  });

  it('should throw for unknown provider', () => {
    expect(() =>
      createSTTProvider({
        provider: 'unknown' as never,
        config: { provider: 'unknown', sampleRate: 8000 },
      }),
    ).toThrow('Unknown STT provider');
  });
});
