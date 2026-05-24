import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../src/client.js';
import { createMCPClient } from '../src/factory.js';

describe('MCPClient Factory', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'OK' }] }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create MCPClient instance', () => {
    const client = createMCPClient({
      endpoint: 'http://localhost:8080/api/v1/generate',
    });
    expect(client).toBeInstanceOf(MCPClient);
    expect(client.isConnected()).toBe(false);
  });

  it('should pass config to MCPClient', () => {
    const client = createMCPClient({
      endpoint: 'http://localhost:8080/api/v1/generate',
      timeout: 500,
      retryAttempts: 3,
      maxHistoryTurns: 10,
    });
    expect(client).toBeInstanceOf(MCPClient);
  });

  it('should create client with default timeout', () => {
    const client = createMCPClient({
      endpoint: 'http://localhost:8080/api/v1/generate',
    });
    expect(client).toBeInstanceOf(MCPClient);
  });

  it('should create client with auth config', () => {
    const client = createMCPClient({
      endpoint: 'http://localhost:8080/api/v1/generate',
      auth: {
        type: 'bearer',
        credentials: { token: 'test-token' },
      },
    });
    expect(client).toBeInstanceOf(MCPClient);
  });

  it('should return a working client that can connect', async () => {
    const client = createMCPClient({
      endpoint: 'http://localhost:8080/api/v1/generate',
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);
    await client.close();
  });
});
