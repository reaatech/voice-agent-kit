/**
 * @reaatech/voice-agent-webrtc
 *
 * WebRTC browser transport for voice AI agents with WebSocket + Opus support.
 */

export { decodeOpus, encodeOpus, isOpusAvailable } from './codec/opus.js';
export {
  changeVolume,
  convertSampleFormat,
  interleaveToMono,
  monoToInterleave,
  resample,
} from './codec/resampler.js';
export type { WebRTCTransportConfig } from './webrtc-transport.js';
export { WebRTCTransport } from './webrtc-transport.js';
