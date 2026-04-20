# Barge-In Handling

## Capability

Detects user speech during TTS playback and immediately interrupts audio output to handle the new utterance, providing a natural conversational experience where users can interrupt the agent mid-sentence.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `bargeIn.enable` | `z.object({ sessionId: z.string(), config: BargeInConfig })` | `{ enabled: boolean }` | 10 RPM |
| `bargeIn.detect` | `z.object({ sessionId: z.string(), interimTranscript: z.string(), confidence: z.number() })` | `{ interrupted: boolean, action: 'continue' \| 'interrupt' }` | 1000 RPM |
| `bargeIn.trigger` | `z.object({ sessionId: z.string(), reason: z.string() })` | `{ cancelled: boolean, ttsStopped: boolean }` | 100 RPM |
| `bargeIn.disable` | `z.object({ sessionId: z.string() })` | `{ disabled: boolean }` | 10 RPM |

## Usage Examples

### Example 1: Enable barge-in for a session

- **User intent:** Allow user to interrupt TTS playback
- **Tool call:**
  ```json
  {
    "name": "bargeIn.enable",
    "arguments": {
      "sessionId": "sess-abc123",
      "config": {
        "minSpeechDuration": 300,
        "confidenceThreshold": 0.7,
        "silenceThreshold": 200
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "enabled": true
  }
  ```

### Example 2: Detect interruption from STT interim results

- **User intent:** Check if interim transcript indicates user is speaking
- **Tool call:**
  ```json
  {
    "name": "bargeIn.detect",
    "arguments": {
      "sessionId": "sess-abc123",
      "interimTranscript": "wait I didn't mean",
      "confidence": 0.85
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "interrupted": true,
    "action": "interrupt"
  }
  ```

### Example 3: Trigger barge-in (stop TTS and handle new utterance)

- **User intent:** Stop TTS and process user interruption
- **Tool call:**
  ```json
  {
    "name": "bargeIn.trigger",
    "arguments": {
      "sessionId": "sess-abc123",
      "reason": "user_interrupted"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "cancelled": true,
    "ttsStopped": true
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| TTS already stopped | Race condition | Log warning, continue with new utterance |
| False positive detection | Background noise | Tune confidence threshold, add min duration |
| Missed detection | Low confidence threshold | Lower threshold, increase STT sensitivity |
| WebSocket send failure | Connection closed | Cleanup session, end call |

### Recovery Strategies

- **TTS cancel failure:** Force close WebSocket connection
- **Detection errors:** Default to allowing interruption (better UX)
- **Race conditions:** Use atomic operations for state changes

## Security Considerations

### PII Handling

- Never log full interim transcripts
- Redact potential PII in interruption logs
- Hash session IDs in non-operational logs

### Permissions

- Barge-in requires active TTS playback
- Configuration changes require valid session
- Disable requires admin privileges in production

### Audit Logging

- Log all barge-in events with timestamps
- Track false positive/negative rates
- Record configuration changes

## Barge-In Configuration

### Configuration Options

```yaml
# voice-agent-kit.config.ts
bargeIn:
  # Detection settings
  enabled: true
  minSpeechDuration: 300    # ms of speech before triggering
  confidenceThreshold: 0.7  # STT confidence required
  silenceThreshold: 200     # ms silence before considering complete
  
  # Response settings
  immediateCancel: true     # Cancel TTS immediately on detect
  drainQueue: false         # Don't send remaining TTS chunks
  
  # Tuning
  ignoreShortUtterances: true  # Ignore < 2 words
  minWords: 2
```

### Detection Logic

```typescript
function shouldInterrupt(interimTranscript: string, confidence: number): boolean {
  // Don't interrupt if confidence too low
  if (confidence < 0.7) return false;
  
  // Don't interrupt for very short utterances (likely noise)
  const words = interimTranscript.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) return false;
  
  // Interrupt for common interruption patterns
  const interruptionPatterns = [
    /\b(wait|stop|hold on|never mind|actually|no|that's not)/i,
    /\b(let me|I want|I need|can I)\b/i
  ];
  
  return interruptionPatterns.some(pattern => pattern.test(interimTranscript));
}
```

### TTS Cancellation Flow

```
1. STT emits interim transcript during TTS playback
   │
2. Barge-in detector evaluates transcript + confidence
   │
3. If interruption detected:
   │  a. Send 'clear' message to Twilio (stops playback)
   │  b. Cancel in-flight TTS synthesis
   │  c. Emit 'barge_in' event
   │  d. Feed new utterance to pipeline
   │
4. Previous turn abandoned (no history update)
   │
5. New turn begins with user's interruption
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.barge_in.count` | Counter | Total barge-in events |
| `voice.barge_in.false_positives` | Counter | Incorrectly triggered interruptions |
| `voice.barge_in.missed` | Counter | Missed interruptions (user repeated) |
| `voice.barge_in.latency_ms` | Histogram | Time from speech detect to TTS cancel |

### Tracing

| Span | Attributes |
|------|------------|
| `voice.barge_in.detect` | session_id, transcript_length, confidence |
| `voice.barge_in.trigger` | session_id, reason, tts_position_ms |
| `voice.barge_in.cancel_tts` | session_id, chunks_cancelled |

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [STT Provider Interface](../stt-provider-interface/skill.md)
- [TTS Provider Interface](../tts-provider-interface/skill.md)
- [Twilio Media Streams](../twilio-media-streams/skill.md)
