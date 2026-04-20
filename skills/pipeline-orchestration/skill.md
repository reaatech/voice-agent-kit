# Pipeline Orchestration

## Capability

Coordinates the complete voice interaction pipeline from audio input to audio output, managing the flow between STT, MCP client, and TTS stages with event-driven architecture and latency budget enforcement.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `pipeline.create` | `z.object({ sessionId: z.string(), config: z.object({ stt: z.string(), tts: z.string(), mcp: z.string() }) })` | `{ pipelineId: string, status: 'running' }` | 10 RPM |
| `pipeline.processAudio` | `z.object({ pipelineId: z.string(), chunk: z.instanceof(Buffer) })` | `{ events: PipelineEvent[] }` | 1000 RPM |
| `pipeline.cancel` | `z.object({ pipelineId: z.string() })` | `{ cancelled: boolean }` | 60 RPM |
| `pipeline.status` | `z.object({ pipelineId: z.string() })` | `{ status: string, currentStage: string, latencyMs: number }` | 60 RPM |

## Usage Examples

### Example 1: Create and run a pipeline

- **User intent:** Set up a new voice pipeline for a call
- **Tool call:**
  ```json
  {
    "name": "pipeline.create",
    "arguments": {
      "sessionId": "sess-abc123",
      "config": {
        "stt": "deepgram",
        "tts": "deepgram",
        "mcp": "http://mcp-server:8080"
      }
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "pipelineId": "pipe-xyz789",
    "status": "running"
  }
  ```

### Example 2: Process audio through pipeline

- **User intent:** Send audio chunks to be processed
- **Tool call:**
  ```json
  {
    "name": "pipeline.processAudio",
    "arguments": {
      "pipelineId": "pipe-xyz789",
      "chunk": "<base64-encoded-mulaw-audio>"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "events": [
      { "type": "stt:interim", "transcript": "Hello, I need to..." },
      { "type": "stt:final", "transcript": "Hello, I need to reset my password" },
      { "type": "stt:eos" },
      { "type": "mcp:request", "utterance": "Hello, I need to reset my password" },
      { "type": "mcp:response", "text": "I can help with that." },
      { "type": "tts:start" },
      { "type": "tts:first_byte", "latencyMs": 150 },
      { "type": "tts:chunk", "audio": "<base64-audio>" },
      { "type": "tts:complete" },
      { "type": "pipeline:turn:end", "totalLatencyMs": 720 }
    ]
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Pipeline already exists | Duplicate session ID | Return existing pipeline or error |
| Stage timeout | Provider not responding | Cancel stage, emit timeout event, use fallback |
| Backpressure | Audio input faster than processing | Buffer with limits, drop oldest if full |
| Cancellation during MCP | Barge-in detected | Cannot cancel MCP; complete, then handle new utterance |
| Invalid config | Missing provider config | Return validation error with missing fields |

### Recovery Strategies

- **Stage failure:** Emit error event, optionally retry with backoff
- **Pipeline crash:** Auto-cleanup, emit pipeline:error event
- **Resource exhaustion:** Graceful degradation, shed load

## Security Considerations

### PII Handling

- Never log raw audio content
- Redact phone numbers in session metadata
- Hash session IDs in non-operational logs

### Permissions

- Pipeline requires valid session ID
- Audio processing requires authenticated Twilio request
- MCP endpoint must be configured and trusted

### Audit Logging

- Log pipeline lifecycle events (create, start, end, cancel)
- Track latency metrics per stage
- Record error events with context

## Related Skills

- [STT Provider Interface](../stt-provider-interface/skill.md)
- [TTS Provider Interface](../tts-provider-interface/skill.md)
- [MCP Client Integration](../mcp-client-integration/skill.md)
- [Latency Budget](../latency-budget/skill.md)
- [Barge-In Handling](../barge-in-handling/skill.md)
