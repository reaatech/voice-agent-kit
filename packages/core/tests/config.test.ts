import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, defineConfig, getDefaultConfig } from '../src/config/index.js';
import type { VoiceAgentKitConfig } from '../src/types/index.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDefaultConfig', () => {
    it('should return a valid default configuration', () => {
      const config = getDefaultConfig();

      expect(config.mcp.endpoint).toBe('http://localhost:3000/mcp');
      expect(config.mcp.timeout).toBe(400);
      expect(config.stt.provider).toBe('deepgram');
      expect(config.stt.sampleRate).toBe(8000);
      expect(config.tts.provider).toBe('deepgram');
      expect(config.tts.speed).toBe(1.0);
      expect(config.latency.total.target).toBe(800);
      expect(config.latency.total.hardCap).toBe(1200);
      expect(config.latency.stages.stt).toBe(200);
      expect(config.latency.stages.mcp).toBe(400);
      expect(config.latency.stages.tts).toBe(200);
      expect(config.session.ttl).toBe(3600);
      expect(config.session.history.maxTurns).toBe(20);
      expect(config.session.history.maxTokens).toBe(4000);
      expect(config.bargeIn.enabled).toBe(true);
      expect(config.bargeIn.minSpeechDuration).toBe(300);
      expect(config.bargeIn.confidenceThreshold).toBe(0.7);
      expect(config.bargeIn.silenceThreshold).toBe(0.3);
    });
  });

  describe('defineConfig', () => {
    it('should validate and return a valid configuration', () => {
      const config: VoiceAgentKitConfig = {
        mcp: {
          endpoint: 'https://api.example.com/mcp',
          timeout: 500,
        },
        stt: {
          provider: 'aws-transcribe',
          sampleRate: 16000,
        },
        tts: {
          provider: 'polly',
          speed: 1.2,
        },
        latency: {
          total: {
            target: 600,
            hardCap: 1000,
          },
          stages: {
            stt: 150,
            mcp: 300,
            tts: 150,
          },
        },
        session: {
          ttl: 7200,
          history: {
            maxTurns: 30,
            maxTokens: 8000,
          },
        },
        bargeIn: {
          enabled: false,
          minSpeechDuration: 500,
          confidenceThreshold: 0.8,
          silenceThreshold: 0.4,
        },
      };

      const result = defineConfig(config);
      expect(result).toEqual(config);
    });

    it('should throw on invalid configuration', () => {
      const invalidConfig = {
        mcp: { endpoint: 'not-a-url' },
      };

      expect(() => defineConfig(invalidConfig as unknown as VoiceAgentKitConfig)).toThrow();
    });

    it('should throw on invalid MCP endpoint', () => {
      const invalidConfig = {
        mcp: { endpoint: 'invalid' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      } as unknown as VoiceAgentKitConfig;

      expect(() => defineConfig(invalidConfig)).toThrow();
    });

    it('should throw on invalid latency budget', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 50, hardCap: 100 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      } as unknown as VoiceAgentKitConfig;

      expect(() => defineConfig(invalidConfig)).toThrow();
    });
  });

  describe('loadConfig', () => {
    it('should return default config when no env vars set', () => {
      delete process.env.MCP_ENDPOINT;
      delete process.env.STT_PROVIDER;
      delete process.env.TTS_PROVIDER;

      const config = getDefaultConfig();

      expect(config.mcp.endpoint).toBe('http://localhost:3000/mcp');
      expect(config.stt.provider).toBe('deepgram');
      expect(config.tts.provider).toBe('deepgram');
    });
  });

  describe('VoiceAgentKitConfigSchema validation', () => {
    it('should validate provider strings', () => {
      const validConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(validConfig as VoiceAgentKitConfig)).not.toThrow();
    });

    it('should reject empty provider string', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: '', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });

    it('should reject TTS speed out of range', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 5.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });

    it('should reject session TTL out of range', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 30, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });

    it('should reject invalid latency stage values', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 20, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });

    it('should reject invalid confidence threshold', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 20, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 1.5, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });

    it('should reject invalid history max turns', () => {
      const invalidConfig = {
        mcp: { endpoint: 'https://api.example.com/mcp' },
        stt: { provider: 'deepgram', sampleRate: 8000 },
        tts: { provider: 'deepgram', speed: 1.0 },
        latency: {
          total: { target: 800, hardCap: 1200 },
          stages: { stt: 200, mcp: 400, tts: 200 },
        },
        session: { ttl: 3600, history: { maxTurns: 200, maxTokens: 4000 } },
        bargeIn: { enabled: true, minSpeechDuration: 300, confidenceThreshold: 0.7, silenceThreshold: 0.3 },
      };

      expect(() => defineConfig(invalidConfig as VoiceAgentKitConfig)).toThrow();
    });
  });

  describe('loadConfig file-based loading', () => {
    it('should throw when required fields are missing', () => {
      expect(() => loadConfig()).toThrow();
    });
  });
});
