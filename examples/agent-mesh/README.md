# Example: Agent Mesh Orchestrator

This example demonstrates a voice agent that uses the `agent-mesh` orchestrator as its MCP backend, enabling multi-agent voice interactions.

## Use Case

Multi-agent voice interaction where different specialized agents handle different aspects of a conversation.

The agent mesh can:
1. Route queries to specialized agents (sales, support, billing, etc.)
2. Maintain context across agent handoffs
3. Coordinate complex multi-step workflows
4. Provide unified voice interface to agent orchestration

## Prerequisites

- A running `agent-mesh` orchestrator
- Deepgram API key
- Twilio account with a phone number

## Configuration

Create a `voice-agent-kit.config.ts` in this directory:

```typescript
import { defineConfig } from '@reaatech/voice-agent-core';

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
    endpoint: 'http://localhost:8081/api/v1/generate',
    timeout: 500, // Slightly higher for multi-agent routing
  },
  latency: {
    total: { target: 1000, hardCap: 1500 }, // Slightly higher for multi-agent
    stages: {
      stt: 200,
      mcp: 600, // More time for agent routing
      tts: 200,
    },
  },
  session: {
    ttl: 3600,
    history: { maxTurns: 30, maxTokens: 6000 },
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

1. Start the agent-mesh orchestrator:
   ```bash
   cd ../agent-mesh
   pnpm install
   pnpm dev
   ```

2. Start voice-agent-kit:
   ```bash
   cd voice-agent-kit
   pnpm install
   pnpm dev
   ```

3. Configure Twilio webhook:
   ```
   https://your-ngrok-url.ngrok.io/twilio/webhook
   ```

4. Call your Twilio phone number!

## Expected Flow

1. **User**: "I need help with my bill and also want to upgrade my plan."
2. **Agent Mesh**: (routes to billing agent first)
3. **Billing Agent**: "I can help with your bill. What's your account number?"
4. **User**: "12345"
5. **Billing Agent**: (explains the bill)
6. **Agent Mesh**: (routes to sales agent)
7. **Sales Agent**: "I'd be happy to help you upgrade! Here are our current plans..."

## Agent Handoff Behavior

- The agent mesh handles routing transparently
- Voice context is preserved across handoffs
- Each agent receives the full conversation history
- Latency may be slightly higher during handoffs

## Latency Considerations

- Multi-agent routing adds ~100-200ms
- Consider increasing total budget to 1000ms
- Monitor for timeout issues in production

## Troubleshooting

- If agents don't respond, check agent-mesh orchestrator logs
- Verify agent registration and availability
- Check network connectivity between voice-agent-kit and agent-mesh
