# @reaatech/voice-agent-stt

## 0.2.0

### Minor Changes

- [#31](https://github.com/reaatech/voice-agent-kit/pull/31) [`5190a5e`](https://github.com/reaatech/voice-agent-kit/commit/5190a5eafae9259766a648ea4378daf7983c7f63) Thanks [@reaatech](https://github.com/reaatech)! - Prepare packages for first npm publish.

  - **Slimmer installs for cloud STT/TTS.** The AWS (`@aws-sdk/*`) and Google Cloud
    (`@google-cloud/*`) SDKs are now **optional peer dependencies** and are loaded
    lazily via dynamic `import()` only when their adapter is used. Consumers only
    install the SDK for the provider they actually use; Deepgram needs none.
  - **`@opentelemetry/api` is now a peer dependency** of `@reaatech/voice-agent-core`
    (install it alongside core) to avoid duplicate API instances.
  - **Fixed type resolution for CommonJS consumers** — the `require` export condition
    now resolves to `index.d.cts`, validated with `publint`.
  - Removed the unnecessary `typescript` peer dependency from all packages.
  - Added `sideEffects: false` and per-package `engines.node >= 20` for better
    tree-shaking and clearer engine warnings.
  - Emit source maps in the published builds.

### Patch Changes

- Updated dependencies [[`5190a5e`](https://github.com/reaatech/voice-agent-kit/commit/5190a5eafae9259766a648ea4378daf7983c7f63)]:
  - @reaatech/voice-agent-core@0.2.0
