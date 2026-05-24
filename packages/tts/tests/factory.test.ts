import { describe, expect, it } from 'vitest';
import { AWSPollyProvider } from '../src/adapters/aws-polly.js';
import { CartesiaTTSProvider } from '../src/adapters/cartesia.js';
import { DeepgramTTSProvider } from '../src/adapters/deepgram.js';
import { ElevenLabsTTSProvider } from '../src/adapters/elevenlabs.js';
import { GoogleCloudTTSProvider } from '../src/adapters/google-cloud-tts.js';
import type { TTSProviderFactoryConfig } from '../src/factory.js';
import { createTTSProvider } from '../src/factory.js';
import type {
  AWSPollyConfig,
  CartesiaConfig,
  DeepgramTTSConfig,
  ElevenLabsConfig,
  GoogleCloudTTSConfig,
} from '../src/interface.js';

describe('TTS Provider Factory', () => {
  it('should return DeepgramTTSProvider for deepgram', () => {
    const config: TTSProviderFactoryConfig = {
      provider: 'deepgram',
      config: {} as DeepgramTTSConfig,
    };
    const provider = createTTSProvider(config);
    expect(provider).toBeInstanceOf(DeepgramTTSProvider);
  });

  it('should return AWSPollyProvider for aws-polly', () => {
    const config: TTSProviderFactoryConfig = {
      provider: 'aws-polly',
      config: {} as AWSPollyConfig,
    };
    const provider = createTTSProvider(config);
    expect(provider).toBeInstanceOf(AWSPollyProvider);
  });

  it('should return GoogleCloudTTSProvider for google-cloud-tts', () => {
    const config: TTSProviderFactoryConfig = {
      provider: 'google-cloud-tts',
      config: {} as GoogleCloudTTSConfig,
    };
    const provider = createTTSProvider(config);
    expect(provider).toBeInstanceOf(GoogleCloudTTSProvider);
  });

  it('should return ElevenLabsTTSProvider for elevenlabs', () => {
    const config: TTSProviderFactoryConfig = {
      provider: 'elevenlabs',
      config: {} as ElevenLabsConfig,
    };
    const provider = createTTSProvider(config);
    expect(provider).toBeInstanceOf(ElevenLabsTTSProvider);
  });

  it('should return CartesiaTTSProvider for cartesia', () => {
    const config: TTSProviderFactoryConfig = {
      provider: 'cartesia',
      config: {} as CartesiaConfig,
    };
    const provider = createTTSProvider(config);
    expect(provider).toBeInstanceOf(CartesiaTTSProvider);
  });

  it('should throw for unknown provider', () => {
    const config = {
      provider: 'unknown',
      config: {},
    } as unknown as TTSProviderFactoryConfig;

    expect(() => createTTSProvider(config)).toThrow('Unknown TTS provider');
  });

  it('should have name property set for each provider', () => {
    const deepgram = createTTSProvider({ provider: 'deepgram', config: {} as DeepgramTTSConfig });
    expect(deepgram.name).toBe('deepgram');

    const polly = createTTSProvider({ provider: 'aws-polly', config: {} as AWSPollyConfig });
    expect(polly.name).toBe('aws-polly');

    const google = createTTSProvider({
      provider: 'google-cloud-tts',
      config: {} as GoogleCloudTTSConfig,
    });
    expect(google.name).toBe('google-cloud-tts');

    const elevenlabs = createTTSProvider({
      provider: 'elevenlabs',
      config: {} as ElevenLabsConfig,
    });
    expect(elevenlabs.name).toBe('elevenlabs');

    const cartesia = createTTSProvider({ provider: 'cartesia', config: {} as CartesiaConfig });
    expect(cartesia.name).toBe('cartesia');
  });
});
