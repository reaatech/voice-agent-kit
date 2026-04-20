# MCP Client Integration

## Capability

Connects to any MCP (Model Context Protocol) server to process user utterances, discover available tools, manage conversation history, and receive structured agent responses with timeout and retry handling.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `mcp.connect` | `z.object({ endpoint: z.string().url(), auth: z.object({ type: z.string(), credentials: z.record(z.string()) }).optional() })` | `{ connected: boolean, tools: MCPTool[] }` | 10 RPM |
| `mcp.invoke` | `z.object({ sessionId: z.string(), utterance: z.string(), context: z.array(z.object({ role: z.string(), content: z.string() })).optional() })` | `{ response: AgentResponse }` | 100 RPM |
| `mcp.disconnect` | `z.object({ connectionId: z.string() })` | `{ disconnected: boolean }` | 60 RPM |
| `mcp.discover` | `z.object({ endpoint: z.string().url() })` | `{ tools: MCPTool[], version: string }` | 10 RPM |

## Usage Examples

### Example 1: Connect to MCP server

- **User intent:** Establish connection and discover available tools
- **Tool call:**
  ```json
  {
    "name": "mcp.connect",
    "arguments": {
      "endpoint": "http://hybrid-rag-qdrant:8080",
      "auth": {
        "type": "bearer",
        "credentials": {
          "token": "${MCP_API_KEY}"
        }
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "connected": true,
    "tools": [
      {
        "name": "search_documents",
        "description": "Search the document knowledge base",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Search query" }
          },
          "required": ["query"]
        }
      },
      {
        "name": "book_appointment",
        "description": "Schedule an appointment",
        "inputSchema": {
          "type": "object",
          "properties": {
            "date": { "type": "string", "format": "date" },
            "time": { "type": "string", "format": "time" },
            "duration": { "type": "number", "description": "Minutes" }
          },
          "required": ["date", "time"]
        }
      }
    ]
  }
  ```

### Example 2: Send utterance to MCP server

- **User intent:** Process user speech through the agent
- **Tool call:**
  ```json
  {
    "name": "mcp.invoke",
    "arguments": {
      "sessionId": "sess-abc123",
      "utterance": "I'd like to schedule a meeting for tomorrow at 2pm",
      "context": [
        { "role": "user", "content": "Hello, I need to book an appointment" },
        { "role": "assistant", "content": "I can help with that. When would you like to come in?" }
      ]
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "response": {
      "text": "I can schedule a meeting for tomorrow at 2pm. How long will the meeting be?",
      "toolCalls": [],
      "latencyMs": 340,
      "confidence": 0.92
    }
  }
  ```

### Example 3: MCP server uses a tool

- **User intent:** Agent invokes a tool to complete the request
- **Tool call:**
  ```json
  {
    "name": "mcp.invoke",
    "arguments": {
      "sessionId": "sess-abc123",
      "utterance": "30 minutes",
      "context": [
        { "role": "user", "content": "Hello, I need to book an appointment" },
        { "role": "assistant", "content": "I can help with that. When would you like to come in?" },
        { "role": "user", "content": "Tomorrow at 2pm" },
        { "role": "assistant", "content": "I can schedule a meeting for tomorrow at 2pm. How long will the meeting be?" }
      ]
    }
  }
  ```
- **Expected response (with tool call):**
  ```json
  {
    "response": {
      "text": "I've booked a 30-minute meeting for tomorrow at 2pm. You'll receive a confirmation email shortly.",
      "toolCalls": [
        {
          "name": "book_appointment",
          "arguments": {
            "date": "2026-04-16",
            "time": "14:00",
            "duration": 30
          },
          "result": {
            "appointmentId": "apt-789",
            "confirmationSent": true
          }
        }
      ],
      "latencyMs": 520,
      "confidence": 0.95
    }
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Connection refused | MCP server down | Retry with backoff, use fallback response |
| Timeout | Slow MCP response | Cancel request, send timeout message |
| Authentication failure | Invalid credentials | Return error, do not retry |
| Invalid response format | Malformed MCP response | Log error, use fallback response |
| Tool execution error | Tool failed | Return error message to user, suggest retry |

### Recovery Strategies

- **Transient errors:** Single retry with 100ms delay
- **Timeout:** Send "I'm having trouble connecting" message
- **Permanent errors:** Return error, emit fallback response
- **Circuit breaker:** Open after 3 consecutive failures, half-open after 30s

## Security Considerations

### PII Handling

- Never log full conversation content
- Redact potential PII in utterance logs
- Encrypt conversation history in transit (TLS)
- Do not store conversations unless explicitly configured

### Permissions

- MCP endpoint must be configured and trusted
- API keys from environment variables only
- Validate MCP server identity (TLS certificate)
- Rate limit requests per session

### Audit Logging

- Log connection events (connect, disconnect, reconnect)
- Track request/response latency
- Record tool invocations (name, arguments, result)
- Log error events with context

## MCP Client Configuration

### Connection Settings

```yaml
# voice-agent-kit.config.ts
mcp:
  # Server connection
  endpoint: '${MCP_ENDPOINT}'
  
  # Authentication
  auth:
    type: 'bearer'  # or 'api_key', 'oauth', 'none'
    credentials:
      token: '${MCP_API_KEY}'
  
  # Timeout settings
  timeout:
    connect: 5000      # 5 second connection timeout
    request: 400       # 400ms per latency budget
  
  # Retry settings
  retry:
    maxAttempts: 1
    backoffMs: 100
  
  # Circuit breaker
  circuitBreaker:
    enabled: true
    threshold: 3        # Open after 3 failures
    resetTimeout: 30000 # Reset after 30s
```

### History Management

```typescript
// Configurable history window
const historyConfig = {
  maxTurns: 10,        // Last 10 turns
  maxTokens: 2000,     // Or 2000 tokens
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise for voice interaction.'
};

// Build context for MCP request
const context = session.turns.slice(-historyConfig.maxTurns).map(turn => [
  { role: 'user', content: turn.userUtterance },
  { role: 'assistant', content: turn.agentResponse }
]).flat();
```

### Response Post-Processing

```typescript
// Strip SSML-unsafe characters before TTS
function sanitizeForTTS(text: string): string {
  return text
    .replace(/[<>]/g, '')           // Remove angle brackets
    .replace(/&/g, ' and ')         // Replace ampersands
    .replace(/\[([^\]]+)\]/g, '$1') // Remove brackets, keep content
    .trim();
}

// Truncate overly long responses for voice
function truncateForVoice(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.mcp.latency_ms` | Histogram | MCP round-trip time |
| `voice.mcp.requests.total` | Counter | Total MCP requests |
| `voice.mcp.requests.errors` | Counter | Failed requests |
| `voice.mcp.tool_calls.total` | Counter | Tool invocations |
| `voice.mcp.timeouts` | Counter | Request timeouts |
| `voice.mcp.circuit_breaker.state` | Gauge | Circuit breaker state (0=closed, 1=open) |

### Tracing

| Span | Attributes |
|------|------------|
| `voice.mcp.connect` | endpoint, tool_count |
| `voice.mcp.invoke` | session_id, utterance_length, context_turns |
| `voice.mcp.tool_call` | tool_name, success |
| `voice.mcp.error` | error_type, recoverable |

## Related Skills

- [Pipeline Orchestration](../pipeline-orchestration/skill.md)
- [Session Management](../session-management/skill.md)
- [Latency Budget](../latency-budget/skill.md)
