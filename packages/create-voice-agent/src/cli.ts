import { confirm, input, password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import path from 'path';

import { generateProject } from './generator.js';
import type {
  ApiKeys,
  ProjectOptions,
  SttProvider,
  TelephonyProvider,
  TransportType,
  TtsProvider,
} from './types.js';
import { STT_PROVIDERS, TELEPHONY_PROVIDERS, TTS_PROVIDERS } from './types.js';

const program = new Command();

program
  .name('create-voice-agent')
  .description('Scaffold a new voice-agent-kit project')
  .version('0.1.0')
  .argument('[project-name]', 'Name of the project directory')
  .option('--quick', 'Quick mode — use defaults, non-interactive')
  .option('--stt <provider>', 'STT provider')
  .option('--tts <provider>', 'TTS provider')
  .option('--telephony <provider>', 'Telephony provider (twilio, telnyx, none)')
  .option('--transport <type>', 'Transport type (twilio, webrtc)')
  .option('--mcp <endpoint>', 'MCP endpoint URL')
  .option('--skip-install', 'Skip dependency installation')
  .action(async (projectNameArg: string | undefined, options: Record<string, unknown>) => {
    try {
      const quickMode = Boolean(options.quick);

      let projectName: string;
      let sttProvider: SttProvider;
      let ttsProvider: TtsProvider;
      let telephony: TelephonyProvider;
      let transport: TransportType;
      let mcpEndpoint: string;
      let apiKeys: ApiKeys = {};
      let skipInstall: boolean;

      if (quickMode) {
        projectName = projectNameArg || 'my-voice-agent';
        sttProvider = (options.stt as SttProvider) || 'deepgram';
        ttsProvider = (options.tts as TtsProvider) || 'deepgram';
        telephony = (options.telephony as TelephonyProvider) || 'twilio';
        transport = (options.transport as TransportType) || 'twilio';
        mcpEndpoint = (options.mcp as string) || 'http://localhost:3000/mcp';
        skipInstall = Boolean(options.skipInstall);
        apiKeys = {};
      } else {
        console.log(chalk.bold.cyan('\n  Voice Agent Kit — Project Scaffolder\n'));

        projectName = await promptProjectName(projectNameArg);

        sttProvider = await promptSttProvider(options.stt as SttProvider | undefined);

        ttsProvider = await promptTtsProvider(options.tts as TtsProvider | undefined);

        telephony = await promptTelephony(options.telephony as TelephonyProvider | undefined);

        transport = await promptTransport(
          options.transport as TransportType | undefined,
          telephony,
        );

        mcpEndpoint = await promptMcpEndpoint(options.mcp as string | undefined);

        apiKeys = await promptApiKeys(sttProvider, ttsProvider, telephony, transport);

        skipInstall = Boolean(options.skipInstall);
        if (!skipInstall) {
          skipInstall = !(await confirm({
            message: 'Install dependencies after creation?',
            default: true,
          }));
        }
      }

      const projectDir = path.resolve(process.cwd(), projectName);

      const projectOptions: ProjectOptions = {
        projectName,
        sttProvider,
        ttsProvider,
        telephony,
        transport,
        mcpEndpoint,
        apiKeys,
        skipInstall,
        quickMode,
      };

      await generateProject(projectDir, projectOptions);
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log(chalk.yellow('\nCancelled.'));
        process.exit(0);
      }
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function promptProjectName(arg: string | undefined): Promise<string> {
  if (arg) return arg;
  return input({
    message: 'Project name:',
    default: 'my-voice-agent',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) return 'Project name is required';
      if (!/^[a-z0-9._/-]+$/i.test(value)) {
        return 'Project name can only contain letters, numbers, dots, underscores, slashes, and hyphens';
      }
      return true;
    },
  });
}

async function promptSttProvider(cliValue: string | undefined): Promise<SttProvider> {
  if (cliValue) {
    if (!(cliValue in STT_PROVIDERS)) {
      throw new Error(
        `Invalid STT provider: ${cliValue}. Valid options: ${Object.keys(STT_PROVIDERS).join(', ')}`,
      );
    }
    return cliValue as SttProvider;
  }

  return select<SttProvider>({
    message: 'Speech-to-text provider:',
    choices: [
      { name: 'Deepgram (recommended)', value: 'deepgram' },
      { name: 'OpenAI Realtime', value: 'openai-realtime' },
      { name: 'OpenAI Whisper', value: 'openai-whisper' },
      { name: 'AssemblyAI', value: 'assemblyai' },
      { name: 'Groq Whisper', value: 'groq-whisper' },
      { name: 'AWS Transcribe', value: 'aws-transcribe' },
      { name: 'Google Cloud STT', value: 'google-cloud-stt' },
      { name: 'Mock (for testing)', value: 'mock' },
    ],
    default: 'deepgram',
  });
}

async function promptTtsProvider(cliValue: string | undefined): Promise<TtsProvider> {
  if (cliValue) {
    if (!(cliValue in TTS_PROVIDERS)) {
      throw new Error(
        `Invalid TTS provider: ${cliValue}. Valid options: ${Object.keys(TTS_PROVIDERS).join(', ')}`,
      );
    }
    return cliValue as TtsProvider;
  }

  return select<TtsProvider>({
    message: 'Text-to-speech provider:',
    choices: [
      { name: 'Deepgram (recommended)', value: 'deepgram' },
      { name: 'ElevenLabs', value: 'elevenlabs' },
      { name: 'Cartesia', value: 'cartesia' },
      { name: 'AWS Polly', value: 'aws-polly' },
      { name: 'Google Cloud TTS', value: 'google-cloud-tts' },
      { name: 'Mock (for testing)', value: 'mock' },
    ],
    default: 'deepgram',
  });
}

async function promptTelephony(cliValue: string | undefined): Promise<TelephonyProvider> {
  if (cliValue) {
    if (!['twilio', 'telnyx', 'none'].includes(cliValue)) {
      throw new Error(
        `Invalid telephony provider: ${cliValue}. Valid options: twilio, telnyx, none`,
      );
    }
    return cliValue as TelephonyProvider;
  }

  return select<TelephonyProvider>({
    message: 'Telephony provider:',
    choices: [
      { name: 'Twilio (recommended)', value: 'twilio' },
      { name: 'Telnyx', value: 'telnyx' },
      { name: 'None (WebRTC only)', value: 'none' },
    ],
    default: 'twilio',
  });
}

async function promptTransport(
  cliValue: string | undefined,
  telephony: TelephonyProvider,
): Promise<TransportType> {
  if (cliValue) {
    if (!['twilio', 'webrtc'].includes(cliValue)) {
      throw new Error(`Invalid transport type: ${cliValue}. Valid options: twilio, webrtc`);
    }
    return cliValue as TransportType;
  }

  if (telephony === 'none') {
    return 'webrtc';
  }

  return select<TransportType>({
    message: 'Transport type:',
    choices: [
      { name: 'Twilio Media Streams (recommended)', value: 'twilio' },
      { name: 'WebRTC (browser)', value: 'webrtc' },
    ],
    default: 'twilio',
  });
}

async function promptMcpEndpoint(cliValue: string | undefined): Promise<string> {
  if (cliValue) return cliValue;

  return input({
    message: 'MCP server endpoint URL:',
    default: 'http://localhost:3000/mcp',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) return 'MCP endpoint is required';
      return true;
    },
  });
}

async function promptApiKeys(
  sttProvider: SttProvider,
  ttsProvider: TtsProvider,
  telephony: TelephonyProvider,
  _transport: TransportType,
): Promise<ApiKeys> {
  const keys = new Set<keyof ApiKeys>();

  for (const k of STT_PROVIDERS[sttProvider].keys) {
    keys.add(k);
  }
  for (const k of TTS_PROVIDERS[ttsProvider].keys) {
    keys.add(k);
  }
  for (const k of TELEPHONY_PROVIDERS[telephony].keys) {
    keys.add(k);
  }

  if (keys.size === 0) return {};

  console.log(chalk.dim('\n  Enter API keys (press Enter to skip any):\n'));

  const result: ApiKeys = {};

  for (const key of keys) {
    const value = await password({
      message: `${key}:`,
      validate: () => true,
    });

    if (value) {
      result[key] = value;
    }
  }

  return result;
}

program.parse();
