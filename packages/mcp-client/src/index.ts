/**
 * @reaatech/voice-agent-mcp-client
 *
 * MCP client for connecting to any MCP server endpoint.
 */

export { MCPClient } from './client.js';
export { createMCPClient } from './factory.js';
export type {
  MCPClientConfig,
  MCPError,
  MCPMessage,
  MCPRequestParams,
  MCPResponse,
  MCPResult,
  MCPTool,
  MCPToolCall,
} from './types.js';
