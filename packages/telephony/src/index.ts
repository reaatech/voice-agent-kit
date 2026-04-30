/**
 * @reaatech/voice-agent-telephony
 *
 * Twilio Media Streams adapter for voice AI agents.
 */

export { TwilioMediaStreamHandler } from './twilio-handler.js';
export type {
  TwilioMessage,
  TwilioMediaMessage,
  TwilioStartMessage,
  TwilioStopMessage,
  TwilioMarkMessage,
  TwilioDTMFMessage,
  TwilioOutboundMessage,
  TwilioStreamConfig,
} from './types.js';
export type { TwilioHandlerConfig, BargeInEvent } from './twilio-handler.js';
export { createTwilioHandler } from './factory.js';
