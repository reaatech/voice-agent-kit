# STT Provider Interface

## Capability

Provides a unified interface for speech-to-text (STT) providers, enabling real-time streaming transcription with interim results, endpoint detection, and automatic reconnection handling.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `stt.connect` | `z.object({ provider: z.enum(['deepgram', 'aws-transcribe', 'google-cloud']), config: z.object({ apiKey: z.string().optional(), sampleRate: z.number() }) })` | `{ connected: boolean, provider: string }` | 10 RPM |
| `stt.streamAudio` | `z.object({ connectionId: z.string(), chunk: z.instanceof(Buffer), timestamp: z.number() })` | `{ utterances: Utterance[] }` | 1000 RPM |
| `stt.close` | `z.object({ connectionId: z.string() })` | `{ closed: boolean }` | 60 RPM |
| `stt.status` | `z.object({ connectionId: z.string() })` | `{ connected: boolean, latency: number, errorCount: number }` | 60 RPM |

## Usage Examples

### Example 1: Connect to Deepgram STT

- **User intent:** Establish a streaming STT connection
- **Tool call:**
  ```json
  {
    "name": "stt.connect",
    "arguments": {
      "provider": "deepgram",
      "config": {
        "apiKey": "${DEEPGRAM_API_KEY}",
        "sampleRate": 8000
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "connected": true,
    "provider": "deepgram"
  }
  ```

### Example 2: Stream audio and receive transcripts

- **User intent:** Send audio chunks for transcription
- **Tool call:**
  ```json
  {
    "name": "stt.streamAudio",
    "arguments": {
      "connectionId": "stt-conn-123",
      "chunk": "<base64-mulaw-8kHz>",
      "timestamp": 1681617600000
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "utterances": [
      {
        "transcript": "I'd like to book",
        "confidence": 0.87,
        "isFinal": false,
        "timestamp": 1681617600100
      },
      {
        "transcript": "I'd like to book an appointment",
        "confidence": 0.95,
        "isFinal": true,
        "timestamp": 1681617600500,
        "duration_ms": 2300
      }
    ]
  }
  ```

### Example 3: Handle end-of-speech detection

- **User intent:** Detect when user stops speaking
- **Behavior:** The STT provider emits an `endOfSpeech` event after configurable silence threshold (default: 500ms)
- **Usage in pipeline:**
  ```typescript
  sttProvider.onEndOfSpeech(() => {
    // User finished speaking - send to MCP
    pipeline.sendToMCP(lastUtterance);
  });
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| WebSocket disconnect | Network issue, provider restart | Auto-reconnect with exponential backoff |
| Authentication failure | Invalid API key | Return error, do not retry |
| Audio format mismatch | Wrong sample rate or encoding | Convert format or return error |
| Rate limit exceeded | Too many requests | Backoff and retry with jitter |
| Provider timeout | No response within timeout | Reconnect and resume streaming |

### Recovery Strategies

- **Transient errors:** Exponential backoff (100ms, 200ms, 400ms, 800ms, max 5 retries)
- **Permanent errors:** Return error immediately, close connection
- **Reconnection:** Buffer audio during reconnect, resume streaming when ready

## Security Considerations

### PII Handling

- Never log full transcripts in production (only metadata)
- Redact potential PII patterns (phone numbers, SSNs, credit cards) from logs
- Encrypt transcripts at rest if stored

### Permissions

- API keys from environment variables only
- Never expose API keys in client-side code
- Use separate keys per environment (dev/staging/prod)

### Audit Logging

- Log connection events (connect, disconnect, reconnect)
- Track transcription volume (chunks processed, utterances generated)
- Record error events with provider and timestamp

## Provider-Specific Notes

### Deepgram Nova-2

- **Protocol:** WebSocket
- **Features:** Interim + final transcripts, smart formatting, punctuation
- **Endpointing:** Configurable silence threshold (default 500ms)
- **Audio format:** Accepts mulaw 8kHz directly

### AWS Transcribe Streaming

- **Protocol:** HTTP/2
- **Features:** Partial + complete results, speaker identification
- **Endpointing:** Automatic silence detection
- **Audio format:** Requires PCM 16-bit, needs conversion from mulaw

### Google Cloud STT

- **Protocol:** gRPC streaming
- **Features:** Interim + final results, speech adaptation
- **Endpointing:** Single utterance mode or streaming
- **Audio format:** Requires linear16, needs conversion from mulaw

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [Audio Format Conversion](../audio-format-conversion/skill.md)
- [Barge-In Handling](../barge-in-handling/skill.md)
- [Latency Budget](../latency-budget/skill.md)
