import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/generator.js';
import type { ProjectOptions } from '../src/types.js';

function baseOptions(overrides: Partial<ProjectOptions> = {}): ProjectOptions {
  return {
    projectName: 'my-agent',
    sttProvider: 'deepgram',
    ttsProvider: 'deepgram',
    telephony: 'twilio',
    transport: 'twilio',
    mcpEndpoint: 'http://localhost:3000/mcp',
    apiKeys: {},
    skipInstall: true,
    quickMode: true,
    ...overrides,
  };
}

describe('generateProject', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cva-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function readJson(file: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(dir, file), 'utf8'));
  }

  it('scaffolds the expected files', async () => {
    await generateProject(dir, baseOptions());

    for (const file of ['package.json', 'tsconfig.json', 'README.md', '.env.example']) {
      await expect(readFile(join(dir, file), 'utf8')).resolves.toBeTruthy();
    }
  });

  it('writes a valid package.json', async () => {
    await generateProject(dir, baseOptions({ projectName: 'cool-agent' }));
    const pkg = await readJson('package.json');

    expect(pkg.name).toBe('cool-agent');
    expect(pkg.private).toBe(true);
    expect(typeof pkg.dependencies).toBe('object');
  });

  it('pins workspace dependencies to a range that resolves to the published version', async () => {
    // Regression guard: the first npm release is 0.1.0. A caret range on a 0.x
    // version only allows <0.2.0, so the pins must stay ^0.1.x or scaffolded
    // projects fail to install once core is published.
    await generateProject(dir, baseOptions());
    const pkg = (await readJson('package.json')) as { dependencies: Record<string, string> };

    for (const [name, range] of Object.entries(pkg.dependencies)) {
      if (name.startsWith('@reaatech/')) {
        expect(range, `${name} pin`).toBe('^0.1.0');
      }
    }
  });

  it('includes the telephony package for twilio transport', async () => {
    await generateProject(dir, baseOptions({ transport: 'twilio', telephony: 'twilio' }));
    const pkg = (await readJson('package.json')) as { dependencies: Record<string, string> };

    expect(pkg.dependencies['@reaatech/voice-agent-telephony']).toBeDefined();
    expect(pkg.dependencies['@reaatech/voice-agent-webrtc']).toBeUndefined();
  });

  it('includes the webrtc package (not telephony) for webrtc transport', async () => {
    await generateProject(dir, baseOptions({ transport: 'webrtc', telephony: 'none' }));
    const pkg = (await readJson('package.json')) as { dependencies: Record<string, string> };

    expect(pkg.dependencies['@reaatech/voice-agent-webrtc']).toBeDefined();
    expect(pkg.dependencies.ws).toBeDefined();
    expect(pkg.dependencies['@reaatech/voice-agent-telephony']).toBeUndefined();
  });

  it('writes a config file referencing the chosen providers', async () => {
    await generateProject(
      dir,
      baseOptions({ sttProvider: 'assemblyai', ttsProvider: 'elevenlabs' }),
    );
    const config = await readFile(join(dir, 'voice-agent-kit.config.ts'), 'utf8');

    expect(config).toContain('assemblyai');
    expect(config).toContain('elevenlabs');
    expect(config).toContain('defineConfig');
  });

  it('writes a server entry file under src/', async () => {
    await generateProject(dir, baseOptions());
    await expect(readFile(join(dir, 'src', 'index.ts'), 'utf8')).resolves.toContain('import');
  });

  it('records the chosen MCP endpoint in .env', async () => {
    await generateProject(dir, baseOptions({ mcpEndpoint: 'https://agent.example.com/mcp' }));
    const env = await readFile(join(dir, '.env'), 'utf8');

    expect(env).toContain('MCP_ENDPOINT=https://agent.example.com/mcp');
  });
});
