# @reaatech/voice-agent-stt

## 0.1.1

### Patch Changes

- [`fc15d28`](https://github.com/reaatech/voice-agent-kit/commit/fc15d288db28b6c8b11f5fc8beb1885bba160306) Thanks [@reaatech](https://github.com/reaatech)! - - **@reaatech/voice-agent-stt** (patch): PR [#56](https://github.com/reaatech/voice-agent-kit/issues/56) fixes CI audit failure (issue [#55](https://github.com/reaatech/voice-agent-kit/issues/55)) by pinning ws to ^8.21.0 via pnpm overrides, resolving a real security/dep vulnerability relevant to consumers of the ws dependency.

  - **@reaatech/voice-agent-telephony** (patch): PR [#56](https://github.com/reaatech/voice-agent-kit/issues/56) fixes CI audit failure (issue [#55](https://github.com/reaatech/voice-agent-kit/issues/55)) with a pnpm override pinning ws to ^8.21.0, addressing a security advisory that affects downstream installs.
  - **@reaatech/voice-agent-tts** (patch): PR [#56](https://github.com/reaatech/voice-agent-kit/issues/56) fixes CI audit failure (issue [#55](https://github.com/reaatech/voice-agent-kit/issues/55)) by pinning ws to ^8.21.0 via pnpm overrides, resolving a known vulnerability in the ws WebSocket dependency.
  - **@reaatech/voice-agent-webrtc** (patch): PR [#56](https://github.com/reaatech/voice-agent-kit/issues/56) fixes CI audit failure (issue [#55](https://github.com/reaatech/voice-agent-kit/issues/55)) by pinning ws to ^8.21.0 via pnpm overrides; WebRTC consumers benefit from the patched ws dependency.

- [#56](https://github.com/reaatech/voice-agent-kit/pull/56) [`6a4e057`](https://github.com/reaatech/voice-agent-kit/commit/6a4e057a93481d43f3f9de7f833e9c287a5cf5cc) Thanks [@reaatech](https://github.com/reaatech)! - Fix: CI failing on main: audit

  Closes [#55](https://github.com/reaatech/voice-agent-kit/issues/55)
