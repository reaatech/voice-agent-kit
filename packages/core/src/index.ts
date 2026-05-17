/**
 * @reaatech/voice-agent-core
 *
 * Core pipeline, session management, latency budget, and configuration for voice AI agents.
 */

// Config
export {
  defineConfig,
  getDefaultConfig,
  loadConfig,
  VoiceAgentKitConfigSchema,
} from './config/index.js';
export type { LatencyMetrics, StageTiming } from './latency/index.js';
// Latency
export { createLatencyBudget, LatencyBudgetEnforcer, PerformanceMonitor } from './latency/index.js';
export type { ExporterConfig, TelemetryConfig } from './observability/exporter.js';
// Observability exporter utilities
export { DEFAULT_TELEMETRY_CONFIG, getOtelEnvVars } from './observability/exporter.js';
export type { ObservabilityConfig, SpanAttributes } from './observability/index.js';
// Observability
export {
  getObservability,
  initializeObservability,
  Observability,
  shutdownObservability,
} from './observability/index.js';
export type {
  MCPClient,
  PipelineDependencies,
  STTProvider,
  TTSProvider,
} from './pipeline/index.js';
// Pipeline
export { createPipeline, Pipeline } from './pipeline/index.js';
export type { MockMCPClientOptions, MockSTTOptions, MockTTSOptions } from './providers/index.js';
// Mock Providers (for testing)
export {
  createMockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
  MockMCPClient,
  MockSTTProvider,
  MockTTSProvider,
} from './providers/index.js';
export type { SessionManagerOptions } from './session/index.js';
// Session
export {
  getDefaultSessionManager,
  initializeSessionManager,
  SessionManager,
} from './session/index.js';
// Types
export * from './types/index.js';
