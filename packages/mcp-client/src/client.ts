import type { MCPClientConfig, MCPRequestParams, MCPResponse, MCPTool, MCPMessage, MCPResult } from './types.js';

export class MCPClient {
  private config: MCPClientConfig;
  private connected = false;
  private requestId = 0;
  private discoveredTools: MCPTool[] = [];

  constructor(config: MCPClientConfig) {
    this.config = {
      timeout: 400,
      retryAttempts: 1,
      retryDelay: 100,
      maxHistoryTurns: 20,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
    await this.discoverTools();
  }

  async close(): Promise<void> {
    this.connected = false;
    this.discoveredTools = [];
  }

  async sendRequest(params: MCPRequestParams): Promise<MCPResponse> {
    if (!this.connected) {
      throw new Error('MCP client not connected');
    }

    const startTime = performance.now();
    const id = ++this.requestId;

    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method: 'generate',
      params: {
        sessionId: params.sessionId,
        turnId: params.turnId,
        utterance: params.utterance,
        history: this.truncateHistory(params.history),
        tools: params.tools || this.discoveredTools,
      },
    };

    try {
      const response = await this.sendWithRetry(message);
      const latencyMs = performance.now() - startTime;

      return this.parseResponse(response, latencyMs);
    } catch (error) {
      throw new Error(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async discoverTools(): Promise<MCPTool[]> {
    const id = ++this.requestId;

    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method: 'list_tools',
    };

    try {
      const response = await this.sendWithRetry(message);

      if (this.isMCPResult(response)) {
        this.discoveredTools = (response.toolCalls || []).map(tc => ({
          name: tc.name,
          description: typeof tc.arguments?.description === 'string' ? tc.arguments.description : '',
          inputSchema: tc.arguments as Record<string, unknown>,
        }));
      }

      return this.discoveredTools;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tool discovery failed: ${message}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDiscoveredTools(): MCPTool[] {
    return [...this.discoveredTools];
  }

  private async sendWithRetry(message: MCPMessage, attempt = 0): Promise<unknown> {
    try {
      return await this.send(message);
    } catch (error) {
      const isRetryable = error instanceof Error && (
        error.message.startsWith('HTTP 5') ||
        error.message === 'fetch failed' ||
        error.name === 'AbortError' ||
        error.name === 'TypeError'
      );
      if (isRetryable && attempt < (this.config.retryAttempts ?? 0)) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
        return await this.sendWithRetry(message, attempt + 1);
      }
      throw error;
    }
  }

  private async send(message: MCPMessage): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.auth) {
        if (this.config.auth.type === 'bearer') {
          headers['Authorization'] = `Bearer ${this.config.auth.credentials.token}`;
        } else if (this.config.auth.type === 'api-key') {
          const key = this.config.auth.credentials.key;
          if (key) {
            headers['X-API-Key'] = key;
          }
        }
      }

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private truncateHistory(history: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
    const maxTurns = this.config.maxHistoryTurns || 20;
    return history.slice(-maxTurns);
  }

  private parseResponse(response: unknown, latencyMs: number): MCPResponse {
    if (this.isMCPResult(response)) {
      const text = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join(' ');

      return {
        text: this.sanitizeResponse(text),
        toolCalls: response.toolCalls,
        latencyMs,
        confidence: 0.95,
      };
    }

    throw new Error('Invalid MCP response format');
  }

  private sanitizeResponse(text: string): string {
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  private isMCPResult(response: unknown): response is MCPResult {
    return (
      typeof response === 'object' &&
      response !== null &&
      'content' in response &&
      Array.isArray((response as MCPResult).content)
    );
  }
}
