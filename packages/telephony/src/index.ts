/**
 * @reaatech/voice-agent-telephony
 *
 * Twilio Media Streams adapter for voice AI agents.
 */

export { createTwilioHandler } from './factory.js';
export type { BargeInEvent, TwilioHandlerConfig } from './twilio-handler.js';
export { TwilioMediaStreamHandler } from './twilio-handler.js';
export type {
  TwilioDTMFMessage,
  TwilioMarkMessage,
  TwilioMediaMessage,
  TwilioMessage,
  TwilioOutboundMessage,
  TwilioStartMessage,
  TwilioStopMessage,
  TwilioStreamConfig,
} from './types.js';
