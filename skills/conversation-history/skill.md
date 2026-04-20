# Conversation History

## Capability

Manages multi-turn conversation context for voice agents, building structured history for MCP requests, handling context window limits, and maintaining coherent dialogue across turns with token-aware truncation.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `history.build` | `z.object({ sessionId: z.string(), maxTurns: z.number().optional() })` | `{ history: Array<{role: string, content: string}> }` | 1000 RPM |
| `history.append` | `z.object({ sessionId: z.string(), role: z.enum(['user', 'assistant']), content: z.string() })` | `{ appended: boolean, turnCount: number }` | 1000 RPM |
| `history.clear` | `z.object({ sessionId: z.string() })` | `{ cleared: boolean }` | 100 RPM |
| `history.getTurns` | `z.object({ sessionId: z.string(), limit: z.number().optional() })` | `{ turns: Turn[] }` | 100 RPM |

## Usage Examples

### Example 1: Build context for MCP request

- **User intent:** Prepare conversation history for sending to MCP server
- **Tool call:**
  ```json
  {
    "name": "history.build",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "maxTurns": 10
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "history": [
      { "role": "user", "content": "Hello, I need to book an appointment" },
      { "role": "assistant", "content": "I can help with that. When would you like to schedule it?" },
      { "role": "user", "content": "Tomorrow at 2pm if possible" },
      { "role": "assistant", "content": "I have 2pm available tomorrow. How long should the meeting be?" }
    ]
  }
  ```

### Example 2: Append user utterance to history

- **User intent:** Add new user message to conversation history
- **Tool call:**
  ```json
  {
    "name": "history.append",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "role": "user",
      "content": "30 minutes would be perfect"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "appended": true,
    "turnCount": 9
  }
  ```

### Example 3: Append agent response to history

- **User intent:** Add agent response to conversation history
- **Tool call:**
  ```json
  {
    "name": "history.append",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "role": "assistant",
      "content": "I've booked a 30-minute meeting for tomorrow at 2pm. You'll receive a confirmation email shortly."
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "appended": true,
    "turnCount": 10
  }
  ```

### Example 4: Retrieve recent turns

- **User intent:** Get conversation turns for debugging or analysis
- **Tool call:**
  ```json
  {
    "name": "history.getTurns",
    "arguments": {
      "sessionId": "sess-abc123-def456",
      "limit": 5
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "turns": [
      {
        "turnId": "turn-006",
        "userUtterance": "Hello, I need to book an appointment",
        "agentResponse": "I can help with that. When would you like to schedule it?",
        "timestamp": "2026-04-15T23:00:00Z",
        "latencyMs": 620
      },
      {
        "turnId": "turn-007",
        "userUtterance": "Tomorrow at 2pm if possible",
        "agentResponse": "I have 2pm available tomorrow. How long should the meeting be?",
        "timestamp": "2026-04-15T23:00:05Z",
        "latencyMs": 580
      }
    ]
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Session not found | Invalid sessionId | Return empty history or error |
| Token limit exceeded | Context too long | Truncate oldest turns |
| Invalid role | Role not 'user' or 'assistant' | Return validation error |
| Storage error | Database unavailable | Use in-memory fallback |

### Recovery Strategies

- **Token limit exceeded:** Truncate oldest turns, emit warning
- **Storage errors:** Fall back to in-memory with limited history
- **Invalid role:** Reject with clear error message

## Security Considerations

### PII Handling

- Never log full conversation content
- Redact potential PII before storing
- Encrypt history at rest
- Auto-expire sensitive conversations

### Token Budget

```typescript
interface HistoryConfig {
  maxTurns: number;        // Default: 20
  maxTokens: number;       // Default: 4000
  truncateStrategy: 'oldest' | 'smart';
}
```

## Context Window Management

### Automatic Truncation

```typescript
// When adding a new turn that would exceed limits
function truncateHistory(history: Turn[], config: HistoryConfig): Turn[] {
  if (history.length <= config.maxTurns) {
    return history;
  }
  
  // Keep most recent turns
  return history.slice(-config.maxTurns);
}
```

### Smart Truncation (Advanced)

```typescript
// Truncate based on token count while preserving context
function smartTruncate(history: Turn[], maxTokens: number): Turn[] {
  const result: Turn[] = [];
  let tokenCount = 0;
  
  // Iterate from most recent to oldest
  for (const turn of history.slice().reverse()) {
    const turnTokens = estimateTokens(turn);
    if (tokenCount + turnTokens <= maxTokens) {
      result.unshift(turn);
      tokenCount += turnTokens;
    } else {
      break;
    }
  }
  
  return result;
}
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.history.turns` | Histogram | Turns per session |
| `voice.history.tokens` | Histogram | Token usage |
| `voice.history.truncated` | Counter | Truncation events |
| `voice.history.append` | Counter | Append operations |

### Tracing

| Span | Attributes |
|------|------------|
| `voice.history.build` | session_id, turn_count, token_count |
| `voice.history.append` | session_id, role, content_length |
| `voice.history.truncate` | session_id, turns_removed, tokens_removed |

## Related Skills

- [Session Management](../session-management/skill.md)
- [MCP Client Integration](../mcp-client-integration/skill.md)
- [Pipeline Orchestration](../pipeline-orchestration/skill.md)