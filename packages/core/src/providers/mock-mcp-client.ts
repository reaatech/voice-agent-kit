import type { MCPClient } from '../pipeline/index.js';
import type { AgentResponse } from '../types/index.js';

export interface MockMCPClientOptions {
  delay?: number;
  responsePrefix?: string;
  responseSuffix?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  shouldFail?: boolean;
  failureMessage?: string;
}

export class MockMCPClient implements MCPClient {
  private options: MockMCPClientOptions;
  private isConnected = false;
  private requestCount = 0;

  constructor(options: MockMCPClientOptions = {}) {
    this.options = {
      delay: 100,
      responsePrefix: 'I understand you said:',
      responseSuffix: 'How can I help you further?',
      toolCalls: [],
      shouldFail: false,
      failureMessage: 'MCP server error',
      ...options,
    };
  }

  async connect(): Promise<void> {
    this.isConnected = true;
    this.requestCount = 0;
  }

  async sendRequest(params: {
    sessionId: string;
    turnId: string;
    utterance: string;
    history: Array<{ role: string; content: string }>;
  }): Promise<AgentResponse> {
    if (!this.isConnected) {
      throw new Error('MCP client not connected');
    }

    this.requestCount++;

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, this.options.delay));

    if (this.options.shouldFail) {
      throw new Error(this.options.failureMessage ?? 'MCP server error');
    }

    const response: AgentResponse = {
      text: `${this.options.responsePrefix} "${params.utterance}". ${this.options.responseSuffix}`,
      toolCalls: this.options.toolCalls ?? [],
      latencyMs: this.options.delay ?? 100,
      confidence: 0.95,
    };

    return response;
  }

  async close(): Promise<void> {
    this.isConnected = false;
  }

  // Test helpers
  getRequestCount(): number {
    return this.requestCount;
  }

  reset(): void {
    this.requestCount = 0;
  }

  setOptions(options: Partial<MockMCPClientOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

export function createMockMCPClient(options?: MockMCPClientOptions): MockMCPClient {
  return new MockMCPClient(options);
}
