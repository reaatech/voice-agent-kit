---
"@reaatech/voice-agent-stt": patch
"@reaatech/voice-agent-telephony": patch
"@reaatech/voice-agent-tts": patch
"@reaatech/voice-agent-webrtc": patch
---

- **@reaatech/voice-agent-stt** (patch): PR #56 fixes CI audit failure (issue #55) by pinning ws to ^8.21.0 via pnpm overrides, resolving a real security/dep vulnerability relevant to consumers of the ws dependency.
- **@reaatech/voice-agent-telephony** (patch): PR #56 fixes CI audit failure (issue #55) with a pnpm override pinning ws to ^8.21.0, addressing a security advisory that affects downstream installs.
- **@reaatech/voice-agent-tts** (patch): PR #56 fixes CI audit failure (issue #55) by pinning ws to ^8.21.0 via pnpm overrides, resolving a known vulnerability in the ws WebSocket dependency.
- **@reaatech/voice-agent-webrtc** (patch): PR #56 fixes CI audit failure (issue #55) by pinning ws to ^8.21.0 via pnpm overrides; WebRTC consumers benefit from the patched ws dependency.
