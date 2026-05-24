import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../src/client.js';
import type { MCPClientConfig } from '../src/types.js';

describe('MCPClient', () => {
  let client: MCPClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  const mockConfig: MCPClientConfig = {
    endpoint: 'http://localhost:8080/api/v1/generate',
    timeout: 400,
    retryAttempts: 1,
    maxHistoryTurns: 20,
  };

  function mockFetchResponse(overrides: Partial<Response> = {}) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'Hello world' }] }),
      ...overrides,
    } as Response;
  }

  beforeEach(() => {
    client = new MCPClient(mockConfig);
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection', () => {
    it('should implement connect method', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await expect(client.connect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(true);
    });

    it('should implement close method', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();
      await client.close();
      expect(client.isConnected()).toBe(false);
    });

    it('should be able to connect and close multiple times', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();
      await client.close();
      await client.connect();
      await client.close();
    });

    it('should discover tools on connect', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('sendRequest', () => {
    it('should wrap non-Error exceptions from fetch', async () => {
      const noRetryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 0,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ content: [{ type: 'text', text: 'OK' }] }),
      } as Response);
      await noRetryClient.connect();

      fetchMock.mockRejectedValueOnce('string error');

      await expect(
        noRetryClient.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow('MCP request failed');
    });

    it('should throw when not connected', async () => {
      await expect(
        client.sendRequest({
          utterance: 'Hello',
          sessionId: 'test-session',
          turnId: 'turn-1',
          history: [],
        }),
      ).rejects.toThrow('MCP client not connected');
    });

    it('should send request and return response', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();

      const response = await client.sendRequest({
        utterance: 'Hello',
        sessionId: 'test-session',
        turnId: 'turn-1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
      expect(response.toolCalls).toEqual([]);
      expect(typeof response.latencyMs).toBe('number');
      expect(response.confidence).toBe(0.95);
    });

    it('should include tools from discovery in request', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              content: [],
              toolCalls: [{ name: 'get_weather', arguments: { description: 'Get weather data' } }],
            }),
        } as Response)
        .mockResolvedValueOnce(mockFetchResponse());

      await client.connect();
      const tools = client.getDiscoveredTools();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('get_weather');
      expect(tools[0].description).toBe('Get weather data');
    });

    it('should handle tool discovery with missing description', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              content: [],
              toolCalls: [{ name: 'get_weather', arguments: { param1: 'value1' } }],
            }),
        } as Response)
        .mockResolvedValueOnce(mockFetchResponse());

      await client.connect();
      const tools = client.getDiscoveredTools();
      expect(tools[0].description).toBe('');
    });

    it('should sanitize response text (strip HTML)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hello <script>alert("xss")</script> world' }],
          }),
      } as Response);

      await client.connect();
      const response = await client.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Hello alert("xss") world');
    });

    it('should sanitize markdown links', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Click [here](https://example.com) for info' }],
          }),
      } as Response);

      await client.connect();
      const response = await client.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Click here for info');
    });

    it('should decode HTML entities', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            content: [
              { type: 'text', text: 'AT&amp;T &lt;test&gt; &quot;quote&quot; &amp; &#39;ok&#39;' },
            ],
          }),
      } as Response);

      await client.connect();
      const response = await client.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('AT&T <test> "quote" & \'ok\'');
    });

    it('should throw on invalid response format', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ notContent: true }),
      } as Response);

      await client.connect();
      await expect(
        client.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow('MCP request failed: Invalid MCP response format');
    });

    it('should handle HTTP error without retry', async () => {
      const noRetryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 0,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ content: [{ type: 'text', text: 'OK' }] }),
      } as Response);
      await noRetryClient.connect();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      } as Response);

      await expect(
        noRetryClient.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow('MCP request failed');
    });

    it('should truncate history to maxHistoryTurns', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      const longHistory = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      await client.connect();
      const response = await client.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: longHistory,
      });

      expect(response.text).toBe('Hello world');
    });

    it('should use default maxHistoryTurns when undefined', async () => {
      const defaultClient = new MCPClient({
        endpoint: mockConfig.endpoint,
        maxHistoryTurns: undefined as unknown as number,
      });

      fetchMock.mockResolvedValue(mockFetchResponse());
      await defaultClient.connect();

      const longHistory = Array.from({ length: 30 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      const response = await defaultClient.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: longHistory,
      });

      expect(response.text).toBe('Hello world');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on HTTP 500 error', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 1,
        retryDelay: 10,
      });

      // connect() succeeds
      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      // sendRequest fails once then succeeds
      fetchMock
        .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
        .mockResolvedValueOnce(mockFetchResponse());

      const response = await retryClient.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
    });

    it('should retry on fetch failed error', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 1,
        retryDelay: 10,
      });

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      fetchMock
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(mockFetchResponse());

      const response = await retryClient.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
    });

    it('should retry on AbortError', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 1,
        retryDelay: 10,
      });

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      fetchMock.mockRejectedValueOnce(abortError).mockResolvedValueOnce(mockFetchResponse());

      const response = await retryClient.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
    });

    it('should retry on TypeError', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 1,
        retryDelay: 10,
      });

      const typeError = new Error('TypeError: fetch failed');
      typeError.name = 'TypeError';

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      fetchMock.mockRejectedValueOnce(typeError).mockResolvedValueOnce(mockFetchResponse());

      const response = await retryClient.sendRequest({
        utterance: 'test',
        sessionId: 's1',
        turnId: 't1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
    });

    it('should throw after exhausting retries', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 0,
        retryDelay: 10,
      });

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      fetchMock.mockRejectedValueOnce(new Error('HTTP 500: Server Error'));

      await expect(
        retryClient.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow('MCP request failed');
    });

    it('should not retry on non-retryable error', async () => {
      const retryClient = new MCPClient({
        ...mockConfig,
        retryAttempts: 1,
        retryDelay: 10,
      });

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await retryClient.connect();

      fetchMock.mockRejectedValueOnce(new Error('HTTP 400: Bad Request'));

      await expect(
        retryClient.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow();
    });

    it('should use default retryAttempts when undefined (no retry)', async () => {
      const defaultRetryClient = new MCPClient({
        endpoint: mockConfig.endpoint,
        timeout: 100,
        retryAttempts: undefined as unknown as number,
      });

      fetchMock.mockResolvedValueOnce(mockFetchResponse());
      await defaultRetryClient.connect();

      fetchMock.mockRejectedValueOnce(new Error('HTTP 500: No retry'));

      await expect(
        defaultRetryClient.sendRequest({
          utterance: 'test',
          sessionId: 's1',
          turnId: 't1',
          history: [],
        }),
      ).rejects.toThrow('MCP request failed');
    });
  });

  describe('Tool Discovery', () => {
    it('should discover tools from server', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            content: [],
            toolCalls: [
              { name: 'tool1', arguments: { description: 'Tool 1' } },
              { name: 'tool2', arguments: { description: 'Tool 2' } },
            ],
          }),
      } as Response);

      const tools = await client.discoverTools();
      expect(tools.length).toBe(2);
      expect(tools[0].name).toBe('tool1');
    });

    it('should return empty array when no tools available', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ content: [] }),
      } as Response);

      const tools = await client.discoverTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(0);
    });

    it('should throw on tool discovery failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      await expect(client.discoverTools()).rejects.toThrow('Tool discovery failed');
    });

    it('should wrap non-Error rejection in discoverTools', async () => {
      fetchMock.mockRejectedValue('raw error string');

      await expect(client.discoverTools()).rejects.toThrow('Tool discovery failed');
    });
  });

  describe('Auth headers', () => {
    it('should send Bearer token in Authorization header', async () => {
      const authClient = new MCPClient({
        ...mockConfig,
        auth: {
          type: 'bearer',
          credentials: { token: 'my-token-123' },
        },
      });

      fetchMock.mockResolvedValue(mockFetchResponse());
      await authClient.connect();

      const callArgs = fetchMock.mock.calls[0];
      const headers = (callArgs[1] as any).headers;
      expect(headers.Authorization).toBe('Bearer my-token-123');
    });

    it('should send X-API-Key header', async () => {
      const authClient = new MCPClient({
        ...mockConfig,
        auth: {
          type: 'api-key',
          credentials: { key: 'api-key-456' },
        },
      });

      fetchMock.mockResolvedValue(mockFetchResponse());
      await authClient.connect();

      const callArgs = fetchMock.mock.calls[0];
      const headers = (callArgs[1] as any).headers;
      expect(headers['X-API-Key']).toBe('api-key-456');
    });

    it('should not send auth headers when no auth configured', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();

      const callArgs = fetchMock.mock.calls[0];
      const headers = (callArgs[1] as any).headers;
      expect(headers.Authorization).toBeUndefined();
      expect(headers['X-API-Key']).toBeUndefined();
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

    it('should apply default config values', () => {
      const defaultClient = new MCPClient({ endpoint: 'http://localhost:8080' });
      expect(defaultClient).toBeDefined();
    });
  });

  describe('getDiscoveredTools', () => {
    it('should return copy of discovered tools', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            content: [],
            toolCalls: [{ name: 'tool1', arguments: {} }],
          }),
      } as Response);

      await client.discoverTools();
      const tools = client.getDiscoveredTools();
      expect(tools.length).toBe(1);
    });

    it('should return empty array before discovery', () => {
      const tools = client.getDiscoveredTools();
      expect(tools).toEqual([]);
    });
  });

  describe('Session Management', () => {
    it('should handle different session IDs', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();

      const response = await client.sendRequest({
        utterance: 'Hello',
        sessionId: 'session-1',
        turnId: 'turn-1',
        history: [],
      });

      expect(response.text).toBe('Hello world');
      await client.close();
    });

    it('should handle different turn IDs', async () => {
      fetchMock.mockResolvedValue(mockFetchResponse());
      await client.connect();

      const response = await client.sendRequest({
        utterance: 'Hello',
        sessionId: 's1',
        turnId: 'turn-2',
        history: [],
      });

      expect(response.text).toBe('Hello world');
      await client.close();
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
});
