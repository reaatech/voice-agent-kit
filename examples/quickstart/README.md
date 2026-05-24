# Voice Agent Quickstart

Standalone Fastify server that wires the full Twilio → WebSocket → Pipeline → STT/TTS voice agent flow.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/reaatech/voice-agent-kit.git
cd voice-agent-kit
pnpm install

# 2. Build workspace dependencies
pnpm build

# 3. Configure environment
cp examples/quickstart/.env.example examples/quickstart/.env
# Edit .env with your Deepgram API key and MCP endpoint

# 4. Start the server
pnpm --filter @reaatech/voice-agent-quickstart dev
```

## Configure Twilio

1. In your Twilio Console, go to Phone Numbers → Manage → Active Numbers
2. Select your phone number
3. Under "Voice & Fax", set the webhook for "A call comes in" to:
   ```
   https://your-server.example.com/incoming-call
   ```
   (HTTP POST)

4. Call the number — your voice agent answers.

## Architecture

```
Twilio PSTN → Twilio Webhook (POST /incoming-call)
  → TwiML <Connect><Stream>
    → Twilio Media Streams WebSocket (wss://.../stream)
      → TwilioMediaStreamHandler
        → Pipeline (STT → MCP → TTS)
          → Twilio Audio Output
```

## Endpoints

| Method | Path             | Description                        |
|--------|-----------------|------------------------------------|
| POST   | `/incoming-call` | Twilio webhook — returns TwiML     |
| GET    | `/stream`        | WebSocket upgrade — media stream   |
| GET    | `/health`        | Health check + active session count|

## Environment Variables

| Variable           | Required | Default                              | Description              |
|-------------------|----------|--------------------------------------|--------------------------|
| `DEEPGRAM_API_KEY` | Yes      | —                                    | Deepgram STT + TTS key   |
| `MCP_ENDPOINT`     | No       | `http://localhost:3001/api/v1/generate` | MCP server endpoint   |
| `MCP_API_KEY`      | No       | —                                    | MCP bearer token         |
| `PORT`             | No       | `3000`                               | Server listen port       |
