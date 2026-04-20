export interface ExporterConfig {
  type: 'otlp' | 'none';
  endpoint?: string;
}

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  traces: ExporterConfig;
  metrics: ExporterConfig;
}

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  serviceName: 'voice-agent-kit',
  serviceVersion: '0.1.0',
  traces: {
    type: 'otlp',
    endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  },
  metrics: {
    type: 'otlp',
    endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  },
};

export function getOtelEnvVars(): Record<string, string> {
  return {
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME || 'voice-agent-kit',
    OTEL_SERVICE_VERSION: process.env.OTEL_SERVICE_VERSION || '0.1.0',
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || 'http://localhost:4318/v1/metrics',
    OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER || 'otlp',
    OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER || 'otlp',
    OTEL_LOG_LEVEL: process.env.OTEL_LOG_LEVEL || 'info',
    OTEL_BSP_EXPORT_TIMEOUT_MS: process.env.OTEL_BSP_EXPORT_TIMEOUT_MS || '30000',
    OTEL_BSP_SCHEDULE_DELAY_MS: process.env.OTEL_BSP_SCHEDULE_DELAY_MS || '5000',
  };
}

export { DEFAULT_TELEMETRY_CONFIG };
export default DEFAULT_TELEMETRY_CONFIG;