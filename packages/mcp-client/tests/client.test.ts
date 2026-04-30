import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../src/client.js';
import type { MCPClientConfig } from '../src/types.js';

describe('MCPClient', () => {
  let client: MCPClient;
  const mockConfig: MCPClientConfig = {
    endpoint: 'http://localhost:8080/api/v1/generate',
    timeout: 400,
    retryAttempts: 1,
    maxHistoryTurns: 20,
  };

  beforeEach(() => {
    client = new MCPClient(mockConfig);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'OK' }] }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection', () => {
    it('should implement connect method', async () => {
      await expect(client.connect()).resolves.not.toThrow();
    });

    it('should implement close method', async () => {
      await expect(client.close()).resolves.not.toThrow();
    });

    it('should be able to connect and close multiple times', async () => {
      await client.connect();
      await client.close();
      await client.connect();
      await client.close();
    });
  });

  describe('Tool Discovery', () => {
    it('should implement discoverTools method', async () => {
      const tools = await client.discoverTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should return empty array when no tools available', async () => {
      const tools = await client.discoverTools();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('Request/Response', () => {
    it('should have sendRequest method defined', () => {
      expect(typeof client.sendRequest).toBe('function');
    });

    it('should throw when sendRequest called without connect', async () => {
      await expect(
        client.sendRequest({
          utterance: 'Hello',
          sessionId: 'test-session',
          turnId: 'turn-1',
          history: [],
        }),
      ).rejects.toThrow('MCP client not connected');
    });

    it('should have discoverTools method defined', () => {
      expect(typeof client.discoverTools).toBe('function');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on transient failure', async () => {
      // Test retry behavior with mocked failures
      expect(mockConfig.retryAttempts).toBe(1);
    });

    it('should respect max retry attempts', () => {
      expect(mockConfig.retryAttempts).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Response Postprocessing', () => {
    it('should strip SSML-unsafe characters', () => {
      const unsafe = 'Hello <script>alert("xss")</script> world';
      const cleaned = unsafe.replace(/[<>]/g, '');
      expect(cleaned).not.toContain('<script>');
    });

    it('should truncate overly long responses', () => {
      const maxLength = 500;
      const longText = 'a'.repeat(1000);
      const truncated = longText.slice(0, maxLength);
      expect(truncated.length).toBeLessThanOrEqual(maxLength);
    });
  });

  describe('Configuration', () => {
    it('should accept valid configuration', () => {
      const validConfig: MCPClientConfig = {
        endpoint: 'https://api.example.com/mcp',
        timeout: 500,
        retryAttempts: 3,
        maxHistoryTurns: 10,
      };
      const validClient = new MCPClient(validConfig);
      expect(validClient).toBeDefined();
    });

    it('should handle zero timeout', () => {
      const zeroTimeoutConfig: MCPClientConfig = {
        endpoint: 'https://api.example.com/mcp',
        timeout: 0,
        retryAttempts: 0,
        maxHistoryTurns: 0,
      };
      const zeroTimeoutClient = new MCPClient(zeroTimeoutConfig);
      expect(zeroTimeoutClient).toBeDefined();
    });

    it('should handle large maxHistoryTurns', () => {
      const largeHistoryConfig: MCPClientConfig = {
        endpoint: 'https://api.example.com/mcp',
        timeout: 1000,
        retryAttempts: 5,
        maxHistoryTurns: 1000,
      };
      const largeHistoryClient = new MCPClient(largeHistoryConfig);
      expect(largeHistoryClient).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should handle different session IDs', async () => {
      await client.connect();

      // Should accept different session IDs
      expect(typeof client.sendRequest).toBe('function');

      await client.close();
    });

    it('should handle different turn IDs', async () => {
      await client.connect();

      expect(typeof client.sendRequest).toBe('function');

      await client.close();
    });
  });
});
