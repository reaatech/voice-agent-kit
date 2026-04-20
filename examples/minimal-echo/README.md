# Example: Minimal Echo Agent

This is the simplest possible voice agent — it echoes back whatever you say. Use this to verify your telephony, STT, and TTS pipeline is working correctly without any agent logic.

## Use Case

Verify the complete voice pipeline:
1. Twilio Media Streams connection
2. STT transcription
3. TTS synthesis
4. Audio playback

## Prerequisites

- Deepgram API key
- Twilio account with a phone number

## Configuration

Create a `voice-agent-kit.config.ts`:

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
    endpoint: 'http://localhost:3001/api/v1/generate', // Mock echo server
    timeout: 200,
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
    history: { maxTurns: 10, maxTokens: 2000 },
  },
  bargeIn: {
    enabled: true,
    minSpeechDuration: 300,
    confidenceThreshold: 0.7,
    silenceThreshold: 0.3,
  },
});
```

## Mock Echo MCP Server

Create a simple echo server at `mock-echo-server.ts`:

```typescript
import { createServer } from 'http';

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/v1/generate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const utterance = data.params?.utterance || '';

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          content: [{ type: 'text', text: `You said: ${utterance}` }],
        }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3001, () => {
  console.log('Mock echo server running on port 3001');
});
```

## Running

1. Start the mock echo server:
   ```bash
   npx tsx mock-echo-server.ts
   ```

2. Start voice-agent-kit:
   ```bash
   pnpm dev
   ```

3. Configure Twilio webhook:
   ```
   https://your-ngrok-url.ngrok.io/twilio/webhook
   ```

4. Call your Twilio number and say anything — you should hear it echoed back!

## Expected Flow

1. **User**: "Hello, is this thing on?"
2. **Agent**: "You said: Hello, is this thing on?"

That's it! If this works, your pipeline is functioning correctly.

## Troubleshooting

- **No response**: Check Deepgram API key and Twilio credentials
- **Silence**: Verify TTS is working by checking logs
- **Garbled audio**: Check audio format conversion (mulaw 8kHz)
- **Timeouts**: Increase MCP timeout or check mock server
