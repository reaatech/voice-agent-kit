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
// Cost Tracking
export {
  CostTracker,
  createCostTracker,
  DEFAULT_PRICING,
} from './cost/index.js';
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
  S2SPipelineDependencies,
  S2SProvider,
  STTProvider,
  TTSProvider,
} from './pipeline/index.js';
// Pipeline
export {
  createPipeline,
  createPipelineForMode,
  createSpeechToSpeechPipeline,
  Pipeline,
  SpeechToSpeechPipeline,
} from './pipeline/index.js';
// Thinking Audio
export {
  generateFillerTone,
  linear16ToMulaw,
  ThinkingAudioManager,
} from './pipeline/thinking-audio.js';
export type { MockMCPClientOptions, MockSTTOptions, MockTTSOptions } from './providers/index.js';
// Mock Providers (for testing)
// Composite Providers
export {
  type CompositeProviderOptions,
  CompositeSTTProvider,
  CompositeTTSProvider,
  createCompositeSTTProvider,
  createCompositeTTSProvider,
  createMockMCPClient,
  createMockSTTProvider,
  createMockTTSProvider,
  FailoverManager,
  MockMCPClient,
  MockSTTProvider,
  MockTTSProvider,
  type ProviderHealth,
} from './providers/index.js';
// Recording
export {
  createRecordingManager,
  FileSystemStorage,
  MemoryStorage,
  RecordingManager,
  S3Storage,
  writeSessionJson,
  writeTranscriptFile,
  writeWavFile,
} from './recording/index.js';
export type { SessionManagerOptions } from './session/index.js';
// Session
export {
  getDefaultSessionManager,
  initializeSessionManager,
  SessionManager,
} from './session/index.js';
// Transport
export type { Transport, TransportConfig, TransportSessionMetadata } from './transport/index.js';
export type { TransportType } from './types/index.js';
// Types
export * from './types/index.js';
export type { EndpointResult, EnergyVADConfig, VADProvider, VADResult } from './vad/index.js';
// VAD
export {
  createDefaultVADProvider,
  createSemanticEndpointDetector,
  createVADProvider,
  EnergyVADProvider,
  SemanticEndpointDetector,
} from './vad/index.js';
