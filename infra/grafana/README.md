# Voice Agent Kit - Grafana Dashboard

Pre-built Grafana dashboard for real-time monitoring of voice AI agent pipelines.

## Quick Start

### Prerequisites

- Grafana 10+ with Prometheus datasource configured
- OpenTelemetry Collector forwarding metrics to Prometheus
- `voice-agent-kit` running with observability enabled

### Import Dashboard

**Via Grafana UI:**

1. Navigate to **Dashboards > New > Import**
2. Upload `dashboard.json` or paste its contents
3. Select your Prometheus datasource

**Via API:**

```bash
curl -X POST http://admin:admin@localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @infra/grafana/dashboard.json
```

**With authentication:**

```bash
GRAFANA_URL="https://grafana.example.com"
GRAFANA_API_KEY="your-api-key"

curl -X POST "${GRAFANA_URL}/api/dashboards/db" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @infra/grafana/dashboard.json
```

### Dashboard Sections

| Row | Panels | Description |
|-----|--------|-------------|
| **Overview** | Active sessions, calls/min, p50/p99 latency | High-level health at a glance |
| **Latency** | p50/p95/p99 turn latency, heatmap, stage breakdown | Identify bottlenecks in STT/MCP/TTS |
| **Pipeline Events** | TTS first-byte, barge-in rate, budget exceeded | Pipeline event metrics and error rates |
| **Cost** | Cumulative cost, per-minute rate, per-turn cost | Real-time cost tracking |
| **Sessions** | Active sessions timeline, summary stats | Session lifecycle monitoring |

### Metrics Required

The dashboard queries these OpenTelemetry metrics, emitted by `voice-agent-kit`:

| Metric | Type | Description |
|--------|------|-------------|
| `voice_turn_duration_ms` | Histogram | End-to-end turn duration |
| `voice_stt_latency_ms` | Histogram | STT transcription latency |
| `voice_mcp_latency_ms` | Histogram | MCP agent round-trip time |
| `voice_tts_first_byte_ms` | Histogram | TTS time to first audio byte |
| `voice_barge_in_count` | Counter | Number of barge-in events |
| `voice_latency_budget_exceeded` | Counter | Budget exceeded by stage |
| `voice_session_active` | UpDownCounter | Active sessions count |
| `voice_cost_per_turn` | Histogram | Cost per turn (cents) |
| `voice_cost_total` | Counter | Cumulative total cost (cents) |
| `voice_cost_per_minute` | Gauge | Cost rate per minute (cents/min) |

### OpenTelemetry Collector

Configuration for forwarding metrics from your app to the dashboard:

```bash
# From your app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Or use the included otelcol-config.yaml
otelcol --config infra/grafana/otelcol-config.yaml
```

### Customization

- **Latency thresholds**: Edit the stat panel thresholds and budget line expressions
- **Time ranges**: Default is last 1 hour; adjust the `time.from` in dashboard JSON
- **Alerting**: Create alert rules on any panel via the Grafana UI
- **Provider breakdown**: Add `by (provider)` to cost metric queries for per-provider views

### Troubleshooting

**No data appearing:**
1. Verify `voice-agent-kit` has observability enabled (`enabled: true`)
2. Check OTLP endpoint is reachable: `curl http://localhost:4318/v1/metrics`
3. Confirm Prometheus is scraping the OTLP metric endpoint
4. Verify metric names match (check for prefixes/suffixes added by the collector)

**Gauge metrics not showing:**
- `voice_cost_per_minute` is a Gauge type and may need explicit scrape in the collector config
- Ensure the OTel collector's Prometheus exporter supports Gauge types
