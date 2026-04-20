# Latency Budget

## Capability

Enforces end-to-end latency budgets for voice interactions, tracking per-stage timing and triggering fallbacks when budgets are exceeded to maintain sub-second response times.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `latency.startTurn` | `z.object({ sessionId: z.string(), turnId: z.string() })` | `{ timerId: string, budget: BudgetConfig }` | 100 RPM |
| `latency.checkStage` | `z.object({ timerId: z.string(), stage: z.enum(['stt', 'mcp', 'tts']) })` | `{ withinBudget: boolean, elapsed: number, remaining: number }` | 1000 RPM |
| `latency.endTurn` | `z.object({ timerId: z.string() })` | `{ totalMs: number, stageBreakdown: Record<string, number>, exceeded: boolean }` | 100 RPM |
| `latency.configure` | `z.object({ budgets: BudgetConfig })` | `{ configured: boolean, activeBudget: BudgetConfig }` | 10 RPM |

## Usage Examples

### Example 1: Start a new turn timer

- **User intent:** Begin tracking latency for a new voice turn
- **Tool call:**
  ```json
  {
    "name": "latency.startTurn",
    "arguments": {
      "sessionId": "sess-abc123",
      "turnId": "turn-001"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "timerId": "timer-xyz789",
    "budget": {
      "total": { "target": 800, "hardCap": 1200 },
      "stages": { "stt": 200, "mcp": 400, "tts": 200 }
    }
  }
  ```

### Example 2: Check stage budget during processing

- **User intent:** Verify MCP stage is within budget
- **Tool call:**
  ```json
  {
    "name": "latency.checkStage",
    "arguments": {
      "timerId": "timer-xyz789",
      "stage": "mcp"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "withinBudget": true,
    "elapsed": 250,
    "remaining": 150
  }
  ```

### Example 3: End turn and get latency report

- **User intent:** Complete turn tracking and get metrics
- **Tool call:**
  ```json
  {
    "name": "latency.endTurn",
    "arguments": {
      "timerId": "timer-xyz789"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "totalMs": 720,
    "stageBreakdown": {
      "stt": 180,
      "mcp": 340,
      "tts": 200
    },
    "exceeded": false
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Timer not found | Invalid timerId | Return error, suggest starting new turn |
| Stage check after end | Timer already ended | Return error with final metrics |
| Budget misconfiguration | Invalid budget values | Validate on configure, reject invalid |
| Clock skew | System time change | Use monotonic clock for measurements |

### Recovery Strategies

- **Timer errors:** Log and continue without blocking pipeline
- **Budget exceeded:** Emit warning metric, optionally trigger fallback
- **Configuration errors:** Use default budgets if config invalid

## Security Considerations

### PII Handling

- Never include user content in latency logs
- Use hashed session IDs in metrics
- Redact phone numbers from any logged data

### Permissions

- Latency tracking requires valid session
- Budget configuration requires admin privileges
- Metrics export requires monitoring permissions

### Audit Logging

- Log all budget exceeded events
- Track per-provider latency trends
- Record configuration changes

## Budget Configuration

### Default Budgets

```yaml
# voice-agent-kit.config.ts
latency:
  total:
    target: 800ms    # Goal for P50
    hardCap: 1200ms  # Maximum acceptable
  stages:
    stt: 200ms       # Speech-to-text
    mcp: 400ms       # MCP round-trip
    tts: 200ms       # TTS first byte
```

### Tuning Guidance

| Provider | STT Budget | TTS Budget | Notes |
|----------|------------|------------|-------|
| Deepgram | 150ms | 150ms | Ultra-low latency, can tighten |
| AWS Transcribe | 250ms | 300ms | Slightly higher latency |
| Google Cloud | 200ms | 250ms | Moderate latency |

### Per-Environment Adjustments

- **Development:** Relax budgets (2x) for testing
- **Staging:** Match production budgets
- **Production:** Monitor P50/P90/P99, adjust quarterly

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.turn.duration_ms` | Histogram | End-to-end turn latency |
| `voice.stt.latency_ms` | Histogram | STT processing time |
| `voice.mcp.latency_ms` | Histogram | MCP round-trip time |
| `voice.tts.first_byte_ms` | Histogram | TTS first audio byte |
| `voice.latency_budget.exceeded` | Counter | Budget violations by stage |

### Alerting Thresholds

- **Warning:** P90 exceeds target budget (800ms)
- **Critical:** P50 exceeds hard cap (1200ms)
- **Page:** Budget exceeded rate > 5% of turns

### Dashboard Panels

1. **Turn Latency Distribution** — P50/P90/P99 over time
2. **Stage Breakdown** — Time spent in each stage
3. **Budget Health** — Percentage of turns within budget
4. **Provider Comparison** — Latency by STT/TTS provider

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [STT Provider Interface](../stt-provider-interface/skill.md)
- [TTS Provider Interface](../tts-provider-interface/skill.md)
- [MCP Client Integration](../mcp-client-integration/skill.md)
