/**
 * @voice-agent-kit/core
 * 
 * Core pipeline, session management, latency budget, and configuration for voice AI agents.
 */

// Types
export * from './types/index.js';

// Config
export { loadConfig, defineConfig, getDefaultConfig, VoiceAgentKitConfigSchema } from './config/index.js';

// Session
export { SessionManager, getDefaultSessionManager, initializeSessionManager } from './session/index.js';
export type { SessionManagerOptions } from './session/index.js';

// Latency
export { LatencyBudgetEnforcer, createLatencyBudget, PerformanceMonitor } from './latency/index.js';
export type { LatencyMetrics, StageTiming } from './latency/index.js';

// Pipeline
export { createPipeline, Pipeline } from './pipeline/index.js';
export type {
  STTProvider,
  TTSProvider,
  MCPClient,
  PipelineDependencies,
} from './pipeline/index.js';

// Mock Providers (for testing)
export {
  MockSTTProvider,
  MockTTSProvider,
  MockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
  createMockMCPClient,
} from './providers/index.js';
export type {
  MockSTTOptions,
  MockTTSOptions,
  MockMCPClientOptions,
} from './providers/index.js';

// Observability
export {
  initializeObservability,
  getObservability,
  shutdownObservability,
  Observability,
} from './observability/index.js';
export type { ObservabilityConfig, SpanAttributes } from './observability/index.js';

// Observability exporter utilities
export {
  DEFAULT_TELEMETRY_CONFIG,
  getOtelEnvVars,
} from './observability/exporter.js';
export type { ExporterConfig, TelemetryConfig } from './observability/exporter.js';
