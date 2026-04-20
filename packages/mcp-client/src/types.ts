export interface MCPClientConfig {
  endpoint: string;
  auth?: {
    type: 'bearer' | 'api-key' | 'oauth';
    credentials: Record<string, string>;
  };
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  maxHistoryTurns?: number;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPRequestParams {
  sessionId: string;
  turnId: string;
  utterance: string;
  history: Array<{ role: string; content: string }>;
  tools?: MCPTool[];
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPResponse {
  text: string;
  toolCalls?: MCPToolCall[];
  latencyMs: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  toolCalls?: MCPToolCall[];
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}
