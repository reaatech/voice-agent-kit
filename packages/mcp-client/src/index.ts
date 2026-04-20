/**
 * @voice-agent-kit/mcp-client
 *
 * MCP client for connecting to any MCP server endpoint.
 */

export { MCPClient } from './client.js';
export type {
  MCPClientConfig,
  MCPTool,
  MCPRequestParams,
  MCPResponse,
  MCPMessage,
  MCPResult,
  MCPError,
  MCPToolCall,
} from './types.js';
export { createMCPClient } from './factory.js';
