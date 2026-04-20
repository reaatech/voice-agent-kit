# Latency Budget Guide

This document explains the latency budget system in voice-agent-kit and provides tuning guidance for each provider.

## Overview

Voice agents require strict latency budgets to feel responsive. The target is **<800ms** from end-of-user-speech to first-audio-byte-out, with a hard cap of **1200ms**.

## Budget Breakdown

| Stage | Default Budget | Typical P50 | Typical P90 | Typical P99 |
|-------|---------------|-------------|-------------|-------------|
| STT (Deepgram Nova-2) | 200ms | 100ms | 150ms | 250ms |
| MCP round-trip | 400ms | 200ms | 350ms | 600ms |
| TTS first byte (Deepgram Aura) | 200ms | 100ms | 150ms | 250ms |
| **Total** | **800ms** | **400ms** | **650ms** | **1100ms** |

## Per-Provider Latency Characteristics

### STT Providers

#### Deepgram Nova-2
- **P50**: 100ms
- **P90**: 150ms
- **P99**: 250ms
- **Notes**: Fastest option, supports interim results
- **Tuning**: Enable `endpointing: 300` for faster end-of-speech detection

#### AWS Transcribe Streaming
- **P50**: 150ms
- **P90**: 250ms
- **P99**: 400ms
- **Notes**: Good accuracy, slightly higher latency
- **Tuning**: Use `languageCode` to reduce processing time

#### Google Cloud STT
- **P50**: 120ms
- **P90**: 200ms
- **P99**: 350ms
- **Notes**: Good multilingual support
- **Tuning**: Use `model: 'latest_short'` for lower latency

### TTS Providers

#### Deepgram Aura
- **P50**: 100ms
- **P90**: 150ms
- **P99**: 250ms
- **Notes**: Streaming, very low latency
- **Tuning**: Use `container: 'none'` to avoid WAV header overhead

#### AWS Polly (Neural)
- **P50**: 200ms
- **P90**: 300ms
- **P99**: 500ms
- **Notes**: High quality, higher latency
- **Tuning**: Use `Engine: 'neural'` for best quality

#### Google Cloud TTS
- **P50**: 150ms
- **P90**: 250ms
- **P99**: 400ms
- **Notes**: Good voice quality
- **Tuning**: Use WaveNet voices for better quality

## Latency Budget Enforcement

The `LatencyBudgetEnforcer` tracks wall-clock time from end-of-user-speech:

```typescript
const budget = new LatencyBudgetEnforcer({
  totalBudgetMs: 800,
  perStage: {
    stt: 200,
    mcp: 400,
    tts: 200,
  },
});

// At each stage
budget.startStage('stt');
// ... STT processing
budget.endStage('stt');

if (budget.isExceeded()) {
  // Log warning, emit metric, optionally use fallback
}
```

## When Budget is Exceeded

1. **Warning logged** with stage label and elapsed time
2. **Metric emitted**: `voice.latency_budget.exceeded` with stage label
3. **Optional fallback**: Return a canned response or skip TTS

## Tuning Recommendations

### For Lower Latency

1. **Use Deepgram for both STT and TTS** — fastest combination
2. **Enable interim results** — start processing before final transcript
3. **Reduce endpointing threshold** — `endpointing: 200` instead of 300
4. **Increase MCP timeout** — prevent retries that add latency
5. **Use streaming TTS** — start playback before full synthesis

### For Higher Quality (with latency tradeoff)

1. **Use AWS Polly Neural** — better voice quality, +100ms
2. **Use Google Cloud TTS WaveNet** — better quality, +50ms
3. **Increase endpointing** — `endpointing: 500` for more complete sentences
4. **Disable interim results** — wait for final transcript

## Monitoring

### Key Metrics

- `voice.turn.duration_ms` — end-to-end per turn (histogram)
- `voice.stt.latency_ms` — time to final transcript
- `voice.tts.first_byte_ms` — time to first audio byte
- `voice.mcp.latency_ms` — MCP round-trip time
- `voice.latency_budget.exceeded` — counter with stage label

### Alerting

Set alerts for:
- P95 turn duration > 800ms
- P99 turn duration > 1200ms
- Latency budget exceeded rate > 5%

## Cold Start Considerations

- **Deepgram**: No cold start (WebSocket always connected)
- **AWS Polly**: ~200ms cold start for first request
- **Google Cloud TTS**: ~150ms cold start

Keep connections warm in production by:
- Maintaining WebSocket connections
- Using connection pooling
- Pre-warming on deployment

## Network Latency

Add ~50-100ms for cross-region deployments. Deploy voice-agent-kit in the same region as your:
- STT provider (Deepgram: us-east-1)
- TTS provider (Deepgram: us-east-1)
- MCP server

## Testing Latency

Use the test suite with coverage to validate latency enforcement:

```bash
pnpm test:coverage
```

Review the `voice.turn.duration_ms` and per-stage histogram metrics in your observability dashboard to monitor P50/P90/P95/P99 latency in production.
