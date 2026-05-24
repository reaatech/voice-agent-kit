/**
 * @reaatech/voice-agent-telephony
 *
 * Multi-provider telephony adapters for voice AI agents.
 * Supports Twilio, Telnyx, SignalWire, and Vonage.
 */

export type {
  BargeInEvent as SignalWireBargeInEvent,
  SignalWireTransportConfig,
} from './adapters/signalwire.js';
export { SignalWireTransport } from './adapters/signalwire.js';
export type {
  BargeInEvent as TelnyxBargeInEvent,
  TelnyxTransportConfig,
} from './adapters/telnyx.js';
export { TelnyxTransport } from './adapters/telnyx.js';
export type {
  BargeInEvent as VonageBargeInEvent,
  VonageTransportConfig,
} from './adapters/vonage.js';
export { VonageTransport } from './adapters/vonage.js';
export type { TelephonyTransportType } from './factory.js';
export {
  createSignalWireTransport,
  createTelnyxTransport,
  createTransport,
  createTwilioHandler,
  createVonageTransport,
} from './factory.js';

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
