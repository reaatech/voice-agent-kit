# Telephony Lifecycle

## Capability

Manages the complete lifecycle of voice calls from TwiML webhook initiation through call completion, including call connect, transfer, conference, and disconnect handling with proper session cleanup.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `telephony.generateTwiML` | `z.object({ sessionId: z.string(), wsUrl: z.string().url() })` | `{ twiml: string }` | 100 RPM |
| `telephony.handleConnect` | `z.object({ callSid: z.string(), from: z.string(), to: z.string() })` | `{ twiml: string, sessionId: string }` | 100 RPM |
| `telephony.handleDisconnect` | `z.object({ callSid: z.string(), disconnectReason: z.string() })` | `{ cleaned: boolean, sessionDuration: number }` | 100 RPM |
| `telephony.transfer` | `z.object({ callSid: z.string(), target: z.string(), type: z.enum(['warm', 'cold']) })` | `{ transferred: boolean }` | 10 RPM |
| `telephony.hangup` | `z.object({ callSid: z.string(), reason: z.string() })` | `{ hungup: boolean }` | 10 RPM |

## Usage Examples

### Example 1: Generate TwiML for Media Stream

- **User intent:** Create TwiML response to initiate Media Stream connection
- **Tool call:**
  ```json
  {
    "name": "telephony.generateTwiML",
    "arguments": {
      "sessionId": "sess-abc123",
      "wsUrl": "wss://voice-agent-kit.example.com/ws"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "twiml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Connect>\n    <Stream url=\"wss://voice-agent-kit.example.com/ws\" />\n  </Connect>\n</Response>"
  }
  ```

### Example 2: Handle inbound call connect

- **User intent:** Process inbound call and create session
- **Tool call:**
  ```json
  {
    "name": "telephony.handleConnect",
    "arguments": {
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "from": "+14155551234",
      "to": "+18005551234"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "twiml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Connect>\n    <Stream url=\"wss://voice-agent-kit.example.com/ws\" />\n  </Connect>\n</Response>",
    "sessionId": "sess-xyz789"
  }
  ```

### Example 3: Handle call disconnect

- **User intent:** Cleanup session when call ends
- **Tool call:**
  ```json
  {
    "name": "telephony.handleDisconnect",
    "arguments": {
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "disconnectReason": "completed"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "cleaned": true,
    "sessionDuration": 125000
  }
  ```

### Example 4: Transfer call to another number

- **User intent:** Transfer call to a different phone number
- **Tool call:**
  ```json
  {
    "name": "telephony.transfer",
    "arguments": {
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "target": "+14155559999",
      "type": "warm"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "transferred": true
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| TwiML generation error | Invalid WebSocket URL | Return error with validation details |
| Session not found on disconnect | Already cleaned up | Log warning, no action needed |
| Transfer failed | Invalid target number | Return error, keep call active |
| Hangup failed | Call already ended | Log warning, cleanup session |
| Twilio API error | Rate limit, auth failure | Retry with backoff, escalate if persistent |

### Recovery Strategies

- **TwiML errors:** Return static fallback TwiML (e.g., "Sorry, we're experiencing technical difficulties")
- **Session cleanup errors:** Force cleanup, log error for investigation
- **Transfer errors:** Announce error to caller, offer to take message

## Security Considerations

### PII Handling

- Redact phone numbers from logs (show last 4 digits only: `***-***-1234`)
- Hash callSid in non-operational logs
- Never log call content or transcripts
- Encrypt call metadata at rest

### Twilio Authentication

- Validate all webhook requests with Twilio signature
- Use environment variables for auth tokens
- Rotate credentials regularly

### Permissions

- Transfer requires elevated permissions
- Hangup requires admin privileges
- Webhook endpoints must be authenticated

### Audit Logging

- Log all call lifecycle events (connect, disconnect, transfer, hangup)
- Track call duration and disposition
- Record transfer targets and reasons
- Log errors with full context

## Call Lifecycle

### Complete Call Flow

```
1. Inbound call to Twilio number
   │
2. Twilio sends webhook to /voice/connect
   │
3. Generate TwiML with Media Stream URL
   │
4. Twilio connects WebSocket to voice-agent-kit
   │
5. Receive 'start' message → create session
   │
6. Process media messages (STT → MCP → TTS)
   │
7. Handle barge-in events as needed
   │
8. Call continues until user hangs up or agent transfers
   │
9. Twilio sends 'stop' message
   │
10. Twilio sends webhook to /voice/disconnect
    │
11. Cleanup session, emit metrics
```

### TwiML Response Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://voice-agent-kit.example.com/ws">
      <Parameter name="sessionId" value="sess-abc123" />
    </Stream>
  </Connect>
</Response>
```

### Disconnect Reasons

| Reason | Description |
|--------|-------------|
| `completed` | Normal call completion |
| `answered` | Call was answered (outbound) |
| `busy` | Called number was busy |
| `fail` | Call failed (invalid number, etc.) |
| `no-answer` | No one answered |
| `canceled` | Call was canceled before answer |
| `rejected` | Call was rejected |

## Configuration

### TwiML Configuration

```yaml
# voice-agent-kit.config.ts
telephony:
  # WebSocket endpoint
  wsUrl: '${WS_URL}'
  
  # TwiML settings
  twiml:
    # Add custom parameters to Stream
    parameters:
      environment: '${ENVIRONMENT}'
    
    # Fallback TwiML on error
    fallback: |
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>We're sorry, but we're experiencing technical difficulties. Please try again later.</Say>
        <Hangup />
      </Response>
  
  # Transfer settings
  transfer:
    maxDuration: 3600      # Max transfer duration in seconds
    requireConfirmation: true  # Require agent confirmation
  
  # Call limits
  limits:
    maxCallDuration: 3600   # 1 hour max
    maxConcurrentCalls: 100 # Per instance
```

### DTMF Handling

```typescript
// Handle DTMF tones from Twilio
twilioWebSocket.on('dtmf', (event: DTMFEvent) => {
  const { digit, duration } = event;
  
  // Emit as pipeline event for menu navigation
  pipeline.emit('dtmf', { digit, duration, sessionId });
});
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `telephony.calls.total` | Counter | Total calls by direction (inbound/outbound) |
| `telephony.calls.active` | Gauge | Currently active calls |
| `telephony.calls.duration_seconds` | Histogram | Call duration |
| `telephony.calls.disconnect_reason` | Counter | Disconnect reasons |
| `telephony.transfers.total` | Counter | Call transfers |
| `telephony.errors.total` | Counter | Telephony errors |

### Tracing

| Span | Attributes |
|------|------------|
| `telephony.connect` | call_sid, from, to, direction |
| `telephony.twiml.generate` | session_id, ws_url |
| `telephony.disconnect` | call_sid, reason, duration |
| `telephony.transfer` | call_sid, target, type |
| `telephony.hangup` | call_sid, reason |

## Related Skills

- [Session Management](../session-management/skill.md)
- [Twilio Media Streams](../twilio-media-streams/skill.md)
- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
