# TTS Provider Interface

## Capability

Provides a unified interface for text-to-speech (TTS) providers, enabling streaming audio synthesis with first-byte latency tracking, voice selection, and output format conversion.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `tts.synthesize` | `z.object({ text: z.string(), config: z.object({ provider: z.string(), voice: z.string().optional(), speed: z.number().optional() }) })` | `{ chunks: AudioChunk[], firstByteMs: number }` | 100 RPM |
| `tts.cancel` | `z.object({ synthesisId: z.string() })` | `{ cancelled: boolean }` | 100 RPM |
| `tts.status` | `z.object({ synthesisId: z.string() })` | `{ status: string, progress: number, chunksGenerated: number }` | 60 RPM |
| `tts.benchmark` | `z.object({ provider: z.string(), text: z.string() })` | `{ firstByteMs: number, totalMs: number, chunkCount: number }` | 10 RPM |

## Usage Examples

### Example 1: Stream TTS synthesis

- **User intent:** Convert text to streaming audio
- **Tool call:**
  ```json
  {
    "name": "tts.synthesize",
    "arguments": {
      "text": "I can help you reset your password. Please hold while I send the reset link.",
      "config": {
        "provider": "deepgram",
        "voice": "aura-asteria-en",
        "speed": 1.0
      }
    }
  }
  ```
- **Expected response (streaming chunks):**
  ```json
  {
    "chunks": [
      { "audio": "<base64-pcm>", "timestamp": 1681617600000, "duration_ms": 50 },
      { "audio": "<base64-pcm>", "timestamp": 1681617600050, "duration_ms": 50 },
      { "audio": "<base64-pcm>", "timestamp": 1681617600100, "duration_ms": 50 }
    ],
    "firstByteMs": 120
  }
  ```

### Example 2: Cancel in-progress TTS (barge-in)

- **User intent:** Stop TTS playback when user interrupts
- **Tool call:**
  ```json
  {
    "name": "tts.cancel",
    "arguments": {
      "synthesisId": "tts-synth-456"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "cancelled": true
  }
  ```

### Example 3: Benchmark TTS latency

- **User intent:** Measure TTS provider performance
- **Tool call:**
  ```json
  {
    "name": "tts.benchmark",
    "arguments": {
      "provider": "deepgram",
      "text": "This is a test message to measure latency."
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "firstByteMs": 145,
    "totalMs": 890,
    "chunkCount": 18
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Provider API error | Invalid text, rate limit | Retry with backoff or use fallback |
| WebSocket disconnect | Network issue | Reconnect and resume if possible |
| Invalid voice ID | Voice not available | Fall back to default voice |
| Text too long | Exceeds provider limit | Truncate or split into multiple requests |
| Synthesis timeout | Provider slow | Cancel and use fallback response |

### Recovery Strategies

- **Transient errors:** Retry once with 100ms delay
- **Permanent errors:** Return error, emit fallback audio (silence or beep)
- **Barge-in cancellation:** Immediately stop synthesis, flush buffers

## Security Considerations

### PII Handling

- Never log full synthesized text in production
- Redact potential PII in TTS input logs
- Do not store audio files unless explicitly configured

### Permissions

- API keys from environment variables only
- Voice selection should be validated against allowed voices
- Rate limiting per API key to prevent abuse

### Audit Logging

- Log synthesis requests (text length, voice, provider)
- Track latency metrics (first-byte, total)
- Record cancellation events (barge-in vs timeout)

## Provider-Specific Notes

### Deepgram Aura

- **Protocol:** WebSocket streaming
- **Features:** Ultra-low latency, multiple voices, streaming output
- **First-byte latency:** ~100-200ms typical
- **Output format:** PCM 24kHz, needs resampling to mulaw 8kHz
- **Voice examples:** `aura-asteria-en`, `aura-perseus-en`, `aura-hera-en`

### AWS Polly

- **Protocol:** REST API with streaming response
- **Features:** Neural voices, SSML support, speech marks
- **First-byte latency:** ~200-400ms typical
- **Output format:** Configurable (mp3, pcm, ogg)
- **Engine:** Use `neural` for best quality

### Google Cloud TTS

- **Protocol:** gRPC streaming
- **Features:** WaveNet and Neural2 voices, SSML, pitch/speed control
- **First-byte latency:** ~200-300ms typical
- **Output format:** LINEAR16, MP3, OGG
- **Voice selection:** `{ languageCode: "en-US", name: "en-US-Neural2-A" }`

## Audio Output Formatting

### Resampling Requirements

All TTS output must be converted to Twilio-compatible format:
- **Encoding:** mulaw (µ-law)
- **Sample rate:** 8000 Hz
- **Channels:** 1 (mono)
- **Frame size:** 20ms (160 samples)

### Chunk Sizing

For smooth Twilio playback:
- **Chunk duration:** 20ms frames
- **Buffer size:** 160 samples per chunk (mulaw 8kHz)
- **Max buffer:** 100ms (5 chunks) to minimize latency

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [Audio Format Conversion](../audio-format-conversion/skill.md)
- [Barge-In Handling](../barge-in-handling/skill.md)
- [Latency Budget](../latency-budget/skill.md)
