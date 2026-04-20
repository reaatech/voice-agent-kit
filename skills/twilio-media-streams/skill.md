# Twilio Media Streams

## Capability

Handles Twilio Media Streams WebSocket connections for real-time bidirectional audio communication, parsing inbound messages, encoding outbound audio, and managing call lifecycle events.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `twilio.handleStart` | `z.object({ message: z.object({ event: z.literal('start'), callSid: z.string(), streamSid: z.string(), format: z.string(), tracks: z.array(z.string()) }) })` | `{ sessionId: string, connected: boolean }` | 100 RPM |
| `twilio.handleMedia` | `z.object({ message: z.object({ event: z.literal('media'), streamSid: z.string(), payload: z.string(), timestamp: z.string() }) })` | `{ audioChunks: AudioChunk[] }` | 1000 RPM |
| `twilio.handleStop` | `z.object({ message: z.object({ event: z.literal('stop'), callSid: z.string(), streamSid: z.string() }) })` | `{ sessionId: string, closed: boolean }` | 100 RPM |
| `twilio.sendAudio` | `z.object({ streamSid: z.string(), audio: z.instanceof(Buffer) })` | `{ sent: boolean, chunkCount: number }` | 1000 RPM |
| `twilio.sendClear` | `z.object({ streamSid: z.string() })` | `{ sent: boolean }` | 100 RPM |
| `twilio.sendMark` | `z.object({ streamSid: z.string(), markId: z.string() })` | `{ sent: boolean, markId: string }` | 100 RPM |

## Usage Examples

### Example 1: Handle call start

- **User intent:** Process Twilio 'start' message when call connects
- **Tool call:**
  ```json
  {
    "name": "twilio.handleStart",
    "arguments": {
      "message": {
        "event": "start",
        "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "format": "audio/x-mulaw",
        "sampleRate": 8000,
        "tracks": ["inbound_audio"]
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "sessionId": "sess-abc123-def456",
    "connected": true
  }
  ```

### Example 2: Process inbound audio

- **User intent:** Convert Twilio media message to audio chunks
- **Tool call:**
  ```json
  {
    "name": "twilio.handleMedia",
    "arguments": {
      "message": {
        "event": "media",
        "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "payload": "Exxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx==",
        "timestamp": "1681617600000"
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "audioChunks": [
      {
        "buffer": "<Buffer 0x7f 0x7f 0x7f ...>",
        "sampleRate": 8000,
        "encoding": "mulaw",
        "channels": 1,
        "timestamp": 1681617600000
      }
    ]
  }
  ```

### Example 3: Send audio to Twilio

- **User intent:** Send TTS audio back to caller
- **Tool call:**
  ```json
  {
    "name": "twilio.sendAudio",
    "arguments": {
      "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "audio": "<Buffer mulaw 8kHz audio>"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "sent": true,
    "chunkCount": 5
  }
  ```

### Example 4: Stop playback (barge-in)

- **User intent:** Clear audio queue when user interrupts
- **Tool call:**
  ```json
  {
    "name": "twilio.sendClear",
    "arguments": {
      "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "sent": true
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Invalid message format | Malformed Twilio message | Log error, skip message |
| WebSocket disconnected | Network issue | Attempt reconnection, cleanup session |
| Audio encoding error | Invalid buffer format | Log error, send silence instead |
| Rate limit exceeded | Too many messages | Buffer messages, send in batches |
| Call already ended | Duplicate stop message | Ignore, cleanup if needed |

### Recovery Strategies

- **WebSocket errors:** Reconnect with exponential backoff (max 3 attempts)
- **Audio errors:** Send silence chunk to maintain stream
- **Message parsing:** Skip malformed messages, continue processing

## Security Considerations

### PII Handling

- Redact phone numbers from logs (show last 4 digits only)
- Hash callSid in non-operational logs
- Never log raw audio content
- Encrypt call metadata at rest

### Twilio Signature Validation

```typescript
// Validate incoming webhook requests
import twilio from 'twilio';

const validator = twilio.validateRequest(
  process.env.TWILIO_AUTH_TOKEN,
  request.headers['x-twilio-signature'],
  request.originalUrl,
  request.body
);

if (!validator) {
  return res.status(403).send('Invalid signature');
}
```

### Permissions

- Validate Twilio request signatures
- Rate limit per callSid
- Require authenticated WebSocket connections

### Audit Logging

- Log all Twilio events (start, media, stop, mark)
- Track call duration and media volume
- Record errors with call context

## Twilio Message Formats

### Inbound Messages

#### Start Message
```json
{
  "event": "start",
  "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "format": "audio/x-mulaw",
  "sampleRate": 8000,
  "tracks": ["inbound_audio"],
  "customParameters": {}
}
```

#### Media Message
```json
{
  "event": "media",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "payload": "Exxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx==",
  "timestamp": "1681617600000"
}
```

#### Stop Message
```json
{
  "event": "stop",
  "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

### Outbound Messages

#### Media Message (audio)
```json
{
  "event": "media",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "payload": "Exxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=="
}
```

#### Clear Message (stop playback)
```json
{
  "event": "clear",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

#### Mark Message (sync point)
```json
{
  "event": "mark",
  "streamSid": "MStreamxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "markId": "mark-001"
}
```

## Audio Format Specifications

### Twilio Audio Format

- **Encoding:** mulaw (µ-law)
- **Sample rate:** 8000 Hz
- **Channels:** 1 (mono)
- **Frame size:** 20ms = 160 samples = 160 bytes

### Chunk Sizing

For smooth playback:
- **Chunk duration:** 20ms (160 bytes mulaw)
- **Max queue:** 100ms (5 chunks) to minimize latency
- **Buffer underrun:** Send silence if no audio available

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `twilio.calls.total` | Counter | Total calls handled |
| `twilio.calls.active` | Gauge | Active calls |
| `twilio.media.chunks` | Counter | Audio chunks processed |
| `twilio.media.bytes` | Counter | Audio bytes transferred |
| `twilio.errors.total` | Counter | Twilio errors |
| `twilio.websocket.disconnects` | Counter | WebSocket disconnections |

### Tracing

| Span | Attributes |
|------|------------|
| `twilio.call.start` | call_sid, stream_sid, format |
| `twilio.media.process` | stream_sid, chunk_size |
| `twilio.call.end` | call_sid, duration_ms |
| `twilio.audio.send` | stream_sid, chunk_count |

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [Session Management](../session-management/skill.md)
- [Barge-In Handling](../barge-in-handling/skill.md)
- [Audio Format Conversion](../audio-format-conversion/skill.md)
- [Telephony Lifecycle](../telephony-lifecycle/skill.md)
