/**
 * @reaatech/voice-agent-simulator
 *
 * Local simulator and CLI dev runner for the voice agent pipeline.
 * Pipes WAV files or microphone input through STT → MCP → TTS without Twilio.
 */

export { captureMicrophone, playAudio, readWavFile, writeWavFile } from './audio-io.js';
export type { LatencyWaterfallRow } from './latency-waterfall.js';
export { renderLatencyWaterfall } from './latency-waterfall.js';
export type {
  SimulatorEvent,
  SimulatorOptions,
  SimulatorResult,
  SimulatorTurnMetrics,
} from './simulator.js';
export { createSimulator, Simulator } from './simulator.js';
