# @reaatech/voice-agent-mcp-client

[![npm version](https://img.shields.io/npm/v/@reaatech/voice-agent-mcp-client)](https://www.npmjs.com/package/@reaatech/voice-agent-mcp-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
[![CI](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/voice-agent-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

JSON-RPC 2.0 client for connecting to any MCP (Model Context Protocol) server endpoint. Tool discovery, conversation history management, retry with backoff, and response sanitization for TTS output.

## Installation

```bash
npm install @reaatech/voice-agent-mcp-client
pnpm add @reaatech/voice-agent-mcp-client
```

## Feature Overview

- **JSON-RPC 2.0 transport** — Standards-compliant protocol over HTTP POST with `fetch`
- **Tool discovery** — `discoverTools()` fetches available tools from MCP server at connect time
- **Bearer and API-key auth** — Pluggable authentication via config
- **Conversation history** — Automatic history truncation to max turns to control context size
- **Retry with backoff** — Configurable retry for 5xx errors, network failures, and timeouts
- **Response sanitization** — Strips HTML, markdown links, and HTML entities from MCP responses for clean TTS
- **Abort signal support** — Timeout-based abort via `AbortController`

## Quick Start

```typescript
import { MCPClient } from '@reaatech/voice-agent-mcp-client';

const client = new MCPClient({
  endpoint: 'https://my-agent.example.com/mcp',
  auth: {
    type: 'bearer',
    credentials: { token: process.env.MCP_API_KEY! },
  },
  timeout: 400,
  retryAttempts: 2,
  maxHistoryTurns: 20,
});

await client.connect();

const response = await client.sendRequest({
  sessionId: 'session-123',
  turnId: 'turn-456',
  utterance: 'What is the weather in Tokyo?',
  history: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there! How can I help?' },
  ],
});

console.log(response.text);       // Clean TTS-ready text
console.log(response.toolCalls);  // Any tool calls made
console.log(response.latencyMs);  // Response time in ms

await client.close();
```

## API Reference

### MCPClient

```typescript
class MCPClient {
  constructor(config: MCPClientConfig);

  connect(): Promise<void>;
  close(): Promise<void>;

  sendRequest(params: MCPRequestParams): Promise<MCPResponse>;
  discoverTools(): Promise<MCPTool[]>;
  isConnected(): boolean;
  getDiscoveredTools(): MCPTool[];
}
```

### MCPClientConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `endpoint` | `string` | — | **Required.** MCP server URL |
| `auth` | `{ type, credentials }` | — | Authentication configuration |
| `timeout` | `number` | `400` | Request timeout in ms |
| `retryAttempts` | `number` | `1` | Number of retry attempts for retryable errors |
| `retryDelay` | `number` | `100` | Delay between retries in ms |
| `maxHistoryTurns` | `number` | `20` | Max conversation turns sent in request history |

### MCPRequestParams

| Property | Type | Description |
|----------|------|-------------|
| `sessionId` | `string` | Session identifier |
| `turnId` | `string` | Turn identifier |
| `utterance` | `string` | User utterance text |
| `history` | `Array<{ role, content }>` | Previous conversation turns |
| `tools` | `MCPTool[]` | Optional tool list override (uses discovered tools by default) |

### MCPResponse

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Sanitized response text ready for TTS |
| `toolCalls` | `MCPToolCall[]` | Tool calls made by the agent |
| `latencyMs` | `number` | Request round-trip latency |
| `confidence` | `number` | Response confidence (default 0.95) |

### MCPTool

```typescript
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
```

## Usage Patterns

### Authentication

**Bearer token:**

```typescript
const client = new MCPClient({
  endpoint: 'https://...',
  auth: { type: 'bearer', credentials: { token: 'sk-...' } },
});
```

**API key:**

```typescript
const client = new MCPClient({
  endpoint: 'https://...',
  auth: { type: 'api-key', credentials: { key: 'pk-...' } },
});
```

### Retry Behavior

Retryable errors: HTTP 5xx responses, `fetch failed` network errors, `AbortError` timeouts, `TypeError` DNS failures. Non-retryable: HTTP 4xx responses.

```typescript
const client = new MCPClient({
  endpoint: 'https://...',
  retryAttempts: 3,
  retryDelay: 200,   // 200ms between retries
  timeout: 500,
});
```

### Response Sanitization

MCP responses are automatically cleaned for TTS consumption:
- HTML tags removed: `<div>Hello</div>` → `Hello`
- Markdown links stripped: `[click here](url)` → `click here`
- HTML entities decoded: `&amp;` → `&`, `&lt;` → `<`

### Tool Discovery

```typescript
await client.connect();               // Automatically discovers tools
const tools = client.getDiscoveredTools(); // Cached tool list

console.log('Available tools:', tools.map(t => t.name));
```

## Related Packages

- [@reaatech/voice-agent-core](https://www.npmjs.com/package/@reaatech/voice-agent-core) — Core types, pipeline, config
- [@reaatech/voice-agent-stt](https://www.npmjs.com/package/@reaatech/voice-agent-stt) — Speech-to-text providers
- [@reaatech/voice-agent-tts](https://www.npmjs.com/package/@reaatech/voice-agent-tts) — Text-to-speech providers

## License

[MIT](https://github.com/reaatech/voice-agent-kit/blob/main/LICENSE)
