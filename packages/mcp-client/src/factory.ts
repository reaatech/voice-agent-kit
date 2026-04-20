import { MCPClient } from './client.js';
import type { MCPClientConfig } from './types.js';

export function createMCPClient(config: MCPClientConfig): MCPClient {
  return new MCPClient(config);
}
