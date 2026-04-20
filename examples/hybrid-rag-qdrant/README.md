# Example: Hybrid RAG + Qdrant Voice Agent

This example demonstrates a voice agent that uses a hybrid RAG (Retrieval-Augmented Generation) backend with Qdrant vector database, accessible via MCP.

## Use Case

"Book an appointment by voice using Cal.com"

The agent can:
1. Understand natural language requests for appointments
2. Search the knowledge base using hybrid search (semantic + keyword)
3. Retrieve relevant documents and context
4. Generate responses using the MCP server
5. Handle multi-turn conversations about scheduling

## Prerequisites

- A running `hybrid-rag-qdrant` MCP server
- Deepgram API key
- Twilio account with a phone number

## Configuration

Create a `voice-agent-kit.config.ts` in this directory:

```typescript
import { defineConfig } from '@voice-agent-kit/core';

export default defineConfig({
  stt: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en',
    smartFormat: true,
    punctuation: true,
    interimResults: true,
    endpointing: 300,
  },
  tts: {
    provider: 'deepgram',
    voice: 'asteria',
    model: 'aura',
  },
  mcp: {
    endpoint: 'http://localhost:8080/api/v1/generate',
    timeout: 400,
  },
  latency: {
    total: { target: 800, hardCap: 1200 },
    stages: {
      stt: 200,
      mcp: 400,
      tts: 200,
    },
  },
  session: {
    ttl: 3600,
    history: { maxTurns: 20, maxTokens: 4000 },
  },
  bargeIn: {
    enabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  },
});
```

## Running Locally

1. Start the hybrid-rag-qdrant MCP server:
   ```bash
   cd ../hybrid-rag-qdrant
   pnpm install
   pnpm dev
   ```

2. Start voice-agent-kit:
   ```bash
   cd voice-agent-kit
   pnpm install
   pnpm dev
   ```

3. Configure Twilio webhook to point to your voice-agent-kit endpoint:
   ```
   https://your-ngrok-url.ngrok.io/twilio/webhook
   ```

4. Call your Twilio phone number and start talking!

## Running with Docker

```bash
docker compose up
```

## Testing Without Twilio

Use the built-in text mode for local testing:

```bash
pnpm test:text "I want to book an appointment for next Tuesday"
```

## Expected Flow

1. **User**: "I'd like to schedule a meeting with Sarah next week."
2. **Agent**: (queries hybrid-rag-qdrant for available slots)
3. **Agent**: "I can offer you Tuesday at 2pm or Wednesday at 10am. Which works better?"
4. **User**: "Tuesday at 2pm works."
5. **Agent**: (creates the appointment via Cal.com integration)
6. **Agent**: "Great! I've booked your meeting with Sarah for Tuesday at 2pm. You'll receive a calendar invite shortly."

## Latency Considerations

- Hybrid RAG search adds ~100-200ms to MCP response time
- Consider increasing MCP budget to 500ms if needed
- Monitor P95 latency in production

## Troubleshooting

- If responses are slow, check Qdrant connection and index size
- Verify MCP server is returning properly formatted responses
- Check logs for latency budget exceeded warnings
