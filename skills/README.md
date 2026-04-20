# Skills

This directory contains modular skill definitions for agent development with voice-agent-kit.

Each skill is a self-contained reference document covering a specific capability area.

## Pipeline Skills

- **pipeline-orchestration** — Build and manage the STT → MCP → TTS pipeline
- **latency-budget** — Track and enforce latency budgets per stage
- **session-management** — Create, update, and clean up voice sessions

## Provider Skills

- **stt-provider-interface** — Implement new STT providers (Deepgram, AWS, Google)
- **tts-provider-interface** — Implement new TTS providers (Deepgram, AWS, Google)
- **audio-format-conversion** — Convert between mulaw, linear16, and resampling

## Telephony Skills

- **twilio-media-streams** — Handle Twilio WebSocket messages and audio
- **telephony-lifecycle** — Complete call lifecycle (connect, transfer, disconnect, DTMF)
- **barge-in-handling** — Detect and handle user interruption during TTS

## MCP Skills

- **mcp-client-integration** — Connect to any MCP server endpoint
- **conversation-history** — Manage multi-turn context for MCP requests
- **response-sanitization** — Clean MCP responses for TTS (strip SSML, markdown)
