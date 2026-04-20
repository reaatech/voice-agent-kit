# Session Management

## Capability

Manages voice call sessions with unique session IDs, conversation history, context preservation across turns, and automatic cleanup on disconnect or timeout.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `session.create` | `z.object({ callSid: z.string(), config: SessionConfig })` | `{ sessionId: string, createdAt: string }` | 100 RPM |
| `session.get` | `z.object({ sessionId: z.string() })` | `{ session: Session | null }` | 1000 RPM |
| `session.update` | `z.object({ sessionId: z.string(), updates: Partial<Session> })` | `{ updated: boolean, session: Session }` | 1000 RPM |
| `session.close` | `z.object({ sessionId: z.string(), reason: z.string().optional() })` | `{ closed: boolean, duration: number }` | 100 RPM |
| `session.cleanup` | `z.object({ olderThan: z.number() })` | `{ cleaned: number }` | 10 RPM |

## Usage Examples

### Example 1: Create a new session on call start

- **User intent:** Initialize a session when Twilio call begins
- **Tool call:**
  ```json
  {
    "name": "session.create",
    "arguments": {
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "config": {
        "mcpEndpoint": "http://mcp-server:8080",
        "sttProvider": "deepgram",
        "ttsProvider": "deepgram",
        "ttl": 3600
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "sessionId": "sess-abc123-def456",
    "createdAt": "2026-04-15T23:00:00Z"
  }
  ```

### Example 2: Append turn to conversation history

- **User intent:** Add user utterance and agent response to session
- **Tool call:**
  ```json
  {
    "name": "session.update",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "updates": {
        "turns": [
          {
            "turnId": "turn-001",
            "userUtterance": "I need to reset my password",
            "agentResponse": "I can help with that. What's your email?",
            "timestamp": "2026-04-15T23:00:05Z",
            "latencyMs": 720
          }
        ]
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "updated": true,
    "session": {
      "sessionId": "sess-abc123-def456",
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "turns": [
        {
          "turnId": "turn-001",
          "userUtterance": "I need to reset my password",
          "agentResponse": "I can help with that. What's your email?",
          "timestamp": "2026-04-15T23:00:05Z",
          "latencyMs": 720
        }
      ],
      "lastActivityAt": "2026-04-15T23:00:05Z"
    }
  }
  ```

### Example 3: Get session with conversation history for MCP request

- **User intent:** Retrieve session context to include in MCP request
- **Tool call:**
  ```json
  {
    "name": "session.get",
    "arguments": {
      "sessionId": "sess-abc123-def456"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "session": {
      "sessionId": "sess-abc123-def456",
      "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "mcpEndpoint": "http://mcp-server:8080",
      "sttProvider": "deepgram",
      "ttsProvider": "deepgram",
      "turns": [
        {
          "turnId": "turn-001",
          "userUtterance": "I need to reset my password",
          "agentResponse": "I can help with that. What's your email?",
          "timestamp": "2026-04-15T23:00:05Z",
          "latencyMs": 720
        }
      ],
      "createdAt": "2026-04-15T23:00:00Z",
      "lastActivityAt": "2026-04-15T23:00:05Z",
      "metadata": {}
    }
  }
  ```

### Example 4: Close session on call end

- **User intent:** Clean up session when call completes
- **Tool call:**
  ```json
  {
    "name": "session.close",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "reason": "call_completed"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "closed": true,
    "duration": 125000
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Session not found | Invalid sessionId or expired | Return null, suggest creating new session |
| Session already closed | Duplicate close call | Return error, log warning |
| TTL expired | Session inactive too long | Auto-cleanup, return not found |
| Storage failure | Database/connection error | Retry with backoff, use in-memory fallback |
| Concurrent updates | Race condition | Use optimistic locking or last-write-wins |

### Recovery Strategies

- **Session not found:** Create new session if call is still active
- **Storage errors:** Fall back to in-memory session store temporarily
- **TTL expiration:** Graceful cleanup with event emission

## Security Considerations

### PII Handling

- Encrypt conversation history at rest
- Hash callSid in non-operational logs
- Redact phone numbers from stored data
- Auto-delete sessions after TTL expires

### Permissions

- Session creation requires authenticated Twilio request
- Session access requires valid session ID
- Session cleanup requires admin privileges

### Audit Logging

- Log session lifecycle events (create, update, close)
- Track session duration and turn count
- Record cleanup operations

## Session Configuration

### Session State Structure

```typescript
interface Session {
  sessionId: string;           // UUID
  callSid: string;             // Twilio Call SID
  mcpEndpoint: string;         // MCP server URL
  sttProvider: string;         // STT provider name
  ttsProvider: string;         // TTS provider name
  turns: Turn[];               // Conversation history
  createdAt: Date;
  lastActivityAt: Date;
  ttl: number;                 // Time-to-live in seconds
  metadata: Record<string, unknown>; // Custom data
  status: 'active' | 'closed';
}

interface Turn {
  turnId: string;
  userUtterance: string;
  agentResponse: string;
  timestamp: Date;
  latencyMs: number;
  toolCalls?: ToolCall[];
}
```

### History Window Configuration

```yaml
# voice-agent-kit.config.ts
session:
  # Conversation history settings
  history:
    maxTurns: 20           # Keep last 20 turns
    maxTokens: 4000        # Or 4000 tokens (whichever is smaller)
    includeToolCalls: true # Include tool call details
  
  # TTL settings
  ttl: 3600                # 1 hour default
  cleanupInterval: 300     # Check every 5 minutes
  
  # Storage backend
  storage:
    type: 'memory'         # or 'redis', 'postgres'
    connectionString: '${SESSION_STORAGE_URL}'
```

### Multi-Turn Context Management

The session manager maintains conversation context for MCP requests:

```typescript
// Build context from session history
const context: Array<{ role: string; content: string }> = [];
for (const turn of session.turns.slice(-5)) {
  context.push({ role: 'user', content: turn.userUtterance });
  context.push({ role: 'assistant', content: turn.agentResponse });
}

// Include in MCP request
const mcpRequest = {
  utterance: currentUtterance,
  context: context,
  sessionId: session.sessionId
};
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.session.active` | Gauge | Current active sessions |
| `voice.session.created` | Counter | Sessions created |
| `voice.session.closed` | Counter | Sessions closed |
| `voice.session.timeout` | Counter | Sessions expired by TTL |
| `voice.session.turn_count` | Histogram | Turns per session |
| `voice.session.duration_seconds` | Histogram | Session duration |

### Tracing

| Span | Attributes |
|------|------------|
| `voice.session.create` | call_sid, mcp_endpoint, stt_provider |
| `voice.session.update` | session_id, turn_count |
| `voice.session.close` | session_id, reason, duration |
| `voice.session.cleanup` | sessions_cleaned, older_than |

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [MCP Client Integration](../mcp-client-integration/skill.md)
- [Twilio Media Streams](../twilio-media-streams/skill.md)
- [Telephony Lifecycle](../telephony-lifecycle/skill.md)
