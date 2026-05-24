// Composite providers
export {
  type CompositeProviderOptions,
  CompositeSTTProvider,
  CompositeTTSProvider,
  createCompositeSTTProvider,
  createCompositeTTSProvider,
  type ProviderHealth,
} from './composite.js';
// Failover manager
export { FailoverManager } from './failover.js';
export {
  createMockMCPClient,
  MockMCPClient,
  type MockMCPClientOptions,
} from './mock-mcp-client.js';
export { createMockSTTProvider, type MockSTTOptions, MockSTTProvider } from './mock-stt.js';
export { createMockTTSProvider, type MockTTSOptions, MockTTSProvider } from './mock-tts.js';
