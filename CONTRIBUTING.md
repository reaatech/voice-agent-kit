# Contributing to voice-agent-kit

This guide covers how to contribute to voice-agent-kit, including adding new STT/TTS adapters, Terraform targets, and provider interface compliance.

## Development Setup

1. **Clone and install**:
   ```bash
   git clone https://github.com/your-org/voice-agent-kit.git
   cd voice-agent-kit
   pnpm install
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Start development**:
   ```bash
   pnpm dev
   ```

## Adding a New STT Adapter

voice-agent-kit ships with Deepgram, OpenAI, AssemblyAI, AWS Transcribe, Google STT, and Groq adapters. To add a new STT provider:

1. **Create the adapter** in `packages/stt/src/adapters/your-provider.ts`:

   ```typescript
   import type { STTProvider, STTConfig } from '../interface.js';
   import type { AudioChunk, Utterance } from '@reaatech/voice-agent-core';

   export class YourSTTProvider implements STTProvider {
     readonly name = 'your-provider';
     
     async connect(config: STTConfig): Promise<void> {
       // Connection logic
     }

     streamAudio(chunk: AudioChunk): void {
       // Stream audio to provider
     }

     onUtterance(cb: (utterance: Utterance) => void): void {
       // Register utterance callback
     }

     onEndOfSpeech(cb: () => void): void {
       // Register end-of-speech callback
     }

     async close(): Promise<void> {
       // Cleanup
     }
   }
   ```

2. **Add tests** in `packages/stt/tests/adapters/your-provider.test.ts`:

   ```typescript
   import { describe, it, expect } from 'vitest';
   import { YourSTTProvider } from '../../src/adapters/your-provider.js';

   describe('YourSTTProvider', () => {
     it('should implement STTProvider interface', () => {
       const provider = new YourSTTProvider();
       expect(provider.name).toBe('your-provider');
     });
   });
   ```

3. **Export from package** in `packages/stt/src/index.ts`:

   ```typescript
   export { YourSTTProvider } from './adapters/your-provider.js';
   ```

4. **Update factory** in `packages/stt/src/factory.ts`:

   ```typescript
   case 'your-provider':
     return new YourSTTProvider();
   ```

5. **Run tests**:
   ```bash
   pnpm test
   ```

## Adding a New TTS Adapter

voice-agent-kit ships with Deepgram, ElevenLabs, Cartesia, AWS Polly, and Google TTS adapters. To add a new TTS provider:

1. **Create the adapter** in `packages/tts/src/adapters/your-provider.ts`:

   ```typescript
   import type { TTSProvider, TTSConfig } from '../interface.js';
   import type { AudioChunk } from '@reaatech/voice-agent-core';

   export class YourTTSProvider implements TTSProvider {
     readonly name = 'your-provider';
     readonly supportsStreaming = true;
     readonly firstByteLatencyMs = null;

     async *synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk> {
       // Synthesis logic
     }

     cancel(): void {
       // Cancel in-progress synthesis
     }
   }
   ```

2. **Add tests** and **export** following the same pattern as STT.

## Adding a New Transport

1. Create in `packages/telephony/src/adapters/your-transport.ts` implementing `Transport` from `@reaatech/voice-agent-core`
2. Add tests
3. Export and add to factory `createTransport()`

## Provider SDK Dependencies

If an adapter needs a heavy provider SDK (e.g. an `@aws-sdk/*` or `@google-cloud/*` package), keep it out of every consumer's install:

- Declare it as an **optional peer dependency** — add it to both `peerDependencies` and `peerDependenciesMeta` (`optional: true`) in the package's `package.json`, and to `devDependencies` so the build and tests resolve it.
- **Load it lazily** with a dynamic `await import('...')` inside the adapter (typically in `connect()` or the client factory), so the SDK is only resolved when that provider is actually used. Import only types statically with `import type`.

This keeps the package installable with no SDK for users who only need another provider (Deepgram needs none).

HTTP-based providers (ElevenLabs, Cartesia, OpenAI, AssemblyAI, Groq) use built-in `fetch()` and need no extra SDK — just type their REST API responses.

## Adding a New Terraform Target

1. **Create directory** in `infra/your-platform/`:

   ```
   infra/your-platform/
   ├── main.tf
   ├── variables.tf
   ├── outputs.tf
   └── README.md
   ```

2. **Follow the pattern** from `infra/aws/` or `infra/gcp/`:
   - Define variables for all configurable values
   - Use data sources for existing resources
   - Output service URL/name for CI/CD

3. **Add validation**:
   ```bash
   cd infra/your-platform
   terraform init
   terraform validate
   tflint
   ```

## Provider Interface Compliance

All STT/TTS providers should include tests that verify:
- Interface implementation
- Audio format handling
- Error handling
- Connection lifecycle

Run the test suite with:

```bash
pnpm test
```

## Code Style

- **TypeScript strict mode** — no `any`, proper types
- **ESLint** — run `pnpm lint` before committing
- **Prettier** — auto-formatted on save
- **Tests** — minimum 90% coverage for core packages

## Pull Request Process

1. **Create feature branch**:
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make changes** with tests

3. **Run CI checks**:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm test:coverage
   ```

4. **Update documentation** if needed

5. **Submit PR** with:
   - Clear description
   - Test results
   - Breaking changes noted

## Testing

### Unit Tests
```bash
pnpm test
```

### Coverage
```bash
pnpm test:coverage
```

## Documentation

- Update `README.md` for user-facing changes
- Update `ARCHITECTURE.md` for architectural changes
- See `examples/quickstart/` for the reference implementation wiring a complete server
- Add a changeset (`pnpm changeset`) for any user-facing change

## Questions?

Open an issue for questions or discussion.
