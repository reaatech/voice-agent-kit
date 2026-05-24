#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';

import { createSimulator, type SimulatorOptions } from './simulator.js';

function parseOptionalInt(value: string | undefined, fallback?: number): number | undefined {
  if (!value) {
    return fallback;
  }
  return Number.parseInt(value, 10);
}

function parseOptionalNumber<T>(
  value: string | undefined,
  parser: (v: string) => T,
  fallback?: T,
): T | undefined {
  if (!value) {
    return fallback;
  }
  return parser(value);
}

function parseSpeed(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid speed multiplier: ${value}. Must be a positive number.`);
  }
  return parsed;
}

function buildOptions(cmd: Command): SimulatorOptions {
  const raw = cmd.opts<Record<string, string | boolean>>();
  const getStr = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === 'string' ? v : undefined;
  };

  return {
    sttProvider: getStr('stt') ?? 'mock',
    ttsProvider: getStr('tts') ?? 'mock',
    mcpEndpoint: getStr('mcp') ?? 'mock',
    sttApiKey: getStr('sttApiKey') ?? process.env.STT_API_KEY,
    ttsApiKey: getStr('ttsApiKey') ?? process.env.TTS_API_KEY,
    mcpApiKey: getStr('mcpApiKey') ?? process.env.MCP_API_KEY,
    mcpTimeout: parseOptionalInt(getStr('mcpTimeout')),
    outputPath: getStr('output'),
    configPath: getStr('config'),
    verbose: raw.verbose === true,
    speedMultiplier: parseOptionalNumber(getStr('speed'), parseSpeed, 1.0),
    saveSession: getStr('saveSession'),
    chunkDurationMs: parseOptionalInt(getStr('chunkDuration'), 20),
    ttsVoice: getStr('ttsVoice'),
    ttsSpeed: parseOptionalNumber(getStr('ttsSpeed'), Number.parseFloat),
  };
}

const program = new Command();

program
  .name('voice-agent-simulator')
  .description('Local voice agent pipeline simulator — no Twilio or phone number required')
  .version('0.1.0');

const wavCommand = new Command('wav')
  .description('Run the pipeline against a WAV file input')
  .requiredOption('-i, --input <path>', 'Path to input WAV file')
  .option(
    '-s, --stt <provider>',
    'STT provider (mock, deepgram, aws-transcribe, google-cloud-stt)',
    'mock',
  )
  .option(
    '-t, --tts <provider>',
    'TTS provider (mock, deepgram, aws-polly, google-cloud-tts)',
    'mock',
  )
  .option('-m, --mcp <endpoint>', 'MCP endpoint URL or "mock"', 'mock')
  .option('-o, --output <path>', 'Output WAV file path for TTS audio')
  .option('-c, --config <path>', 'Path to voice-agent-kit config file')
  .option('--stt-api-key <key>', 'STT provider API key')
  .option('--tts-api-key <key>', 'TTS provider API key')
  .option('--mcp-api-key <key>', 'MCP API key for bearer auth')
  .option('--mcp-timeout <ms>', 'MCP request timeout in milliseconds')
  .option('--tts-voice <voice>', 'TTS voice name')
  .option('--tts-speed <speed>', 'TTS playback speed multiplier')
  .option('--speed <multiplier>', 'Speed multiplier for audio playback (2.0 = double speed)', '1.0')
  .option('--chunk-duration <ms>', 'Duration of each audio chunk in ms', '20')
  .option('-v, --verbose', 'Show per-turn latency waterfall table')
  .option('--save-session <path>', 'Save session transcript and metrics to JSON file')
  .action(async (cmd) => {
    const options = buildOptions(cmd);
    const inputPath = cmd.input as string;

    if (!inputPath) {
      console.error(chalk.red('Error: --input <path> is required'));
      process.exit(1);
    }

    console.log(chalk.dim(`[simulator] STT: ${options.sttProvider}`));
    console.log(chalk.dim(`[simulator] TTS: ${options.ttsProvider}`));
    console.log(chalk.dim(`[simulator] MCP: ${options.mcpEndpoint}`));
    console.log(chalk.dim(`[simulator] Input: ${inputPath}`));

    if (options.outputPath) {
      console.log(chalk.dim(`[simulator] Output: ${options.outputPath}`));
    }

    console.log('');

    const simulator = createSimulator(options);

    simulator.on('turn:start', (_data) => {
      process.stdout.write(chalk.dim('.'));
    });

    simulator.on('turn:final', (data) => {
      if (options.verbose && data.transcript) {
        console.log(chalk.cyan(`\n  User: ${data.transcript}`));
      }
    });

    simulator.on('turn:tts', (data) => {
      if (options.verbose && data?.currentAgentSaid) {
        console.log(chalk.magenta(`  Agent: ${data.currentAgentSaid}`));
      }
    });

    simulator.on('turn:complete', (data) => {
      if (options.verbose) {
        const statusColor = data.budgetExceeded ? chalk.red : chalk.green;
        console.log(
          statusColor(
            `  Turn ${data.turnNumber} complete: ${data.totalMs}ms (STT: ${data.sttMs}ms, MCP: ${data.mcpMs}ms, TTS: ${data.ttsFirstByteMs}ms)`,
          ),
        );
      }
    });

    simulator.on('error', (data) => {
      console.error(chalk.red(`  Error: ${data.error} ${data.stage ? `(${data.stage})` : ''}`));
    });

    try {
      const result = await simulator.runFile(inputPath);

      if (!options.verbose) {
        console.log('');
        console.log(result.waterfallTable);
      }

      console.log('');
      console.log(chalk.dim(`Session: ${result.sessionId}`));
      console.log(chalk.dim(`Turns: ${result.turns.length}`));
      console.log(chalk.dim(`TTS chunks: ${result.totalAudioChunks}`));

      if (options.saveSession) {
        console.log(chalk.green(`Session saved to: ${options.saveSession}`));
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

const micCommand = new Command('mic')
  .description('Run the pipeline against live microphone input')
  .option(
    '-s, --stt <provider>',
    'STT provider (mock, deepgram, aws-transcribe, google-cloud-stt)',
    'mock',
  )
  .option(
    '-t, --tts <provider>',
    'TTS provider (mock, deepgram, aws-polly, google-cloud-tts)',
    'mock',
  )
  .option('-m, --mcp <endpoint>', 'MCP endpoint URL or "mock"', 'mock')
  .option('-o, --output <path>', 'Output WAV file path for TTS audio')
  .option('-c, --config <path>', 'Path to voice-agent-kit config file')
  .option('--stt-api-key <key>', 'STT provider API key')
  .option('--tts-api-key <key>', 'TTS provider API key')
  .option('--mcp-api-key <key>', 'MCP API key for bearer auth')
  .option('--mcp-timeout <ms>', 'MCP request timeout in milliseconds')
  .option('--tts-voice <voice>', 'TTS voice name')
  .option('--tts-speed <speed>', 'TTS playback speed multiplier')
  .option('-v, --verbose', 'Show per-turn latency waterfall table')
  .option('--save-session <path>', 'Save session transcript and metrics to JSON file')
  .action(async (cmd) => {
    const options = buildOptions(cmd);

    console.log(chalk.dim(`[simulator] STT: ${options.sttProvider}`));
    console.log(chalk.dim(`[simulator] TTS: ${options.ttsProvider}`));
    console.log(chalk.dim(`[simulator] MCP: ${options.mcpEndpoint}`));
    console.log(chalk.dim('[simulator] Capturing from microphone... (Ctrl+C to stop)'));
    console.log('');

    const simulator = createSimulator(options);

    simulator.on('turn:start', () => {
      process.stdout.write(chalk.dim('.'));
    });

    simulator.on('turn:final', (data) => {
      if (options.verbose && data.transcript) {
        console.log(chalk.cyan(`\n  User: ${data.transcript}`));
      }
    });

    simulator.on('turn:complete', (data) => {
      if (options.verbose) {
        const statusColor = data.budgetExceeded ? chalk.red : chalk.green;
        console.log(statusColor(`  Turn ${data.turnNumber} complete: ${data.totalMs}ms`));
      }
    });

    simulator.on('error', (data) => {
      console.error(chalk.red(`  Error: ${data.error}`));
    });

    let shuttingDown = false;

    process.on('SIGINT', () => {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      console.log(chalk.yellow('\n\n[simulator] Shutting down...'));
    });

    try {
      const result = await simulator.runMic();

      if (!options.verbose) {
        console.log('');
        console.log(result.waterfallTable);
      }

      console.log('');
      console.log(chalk.dim(`Session: ${result.sessionId}`));
      console.log(chalk.dim(`Turns: ${result.turns.length}`));

      if (options.saveSession) {
        console.log(chalk.green(`Session saved to: ${options.saveSession}`));
      }
    } catch (err) {
      if (!shuttingDown) {
        console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
      }
      process.exit(0);
    }
  });

program.addCommand(wavCommand);
program.addCommand(micCommand);

program.parse();
