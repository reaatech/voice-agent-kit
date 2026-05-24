import type { Transport, TransportType } from '@reaatech/voice-agent-core';

import type { SignalWireTransportConfig } from './adapters/signalwire.js';
import { SignalWireTransport } from './adapters/signalwire.js';
import type { TelnyxTransportConfig } from './adapters/telnyx.js';
import { TelnyxTransport } from './adapters/telnyx.js';
import type { VonageTransportConfig } from './adapters/vonage.js';
import { VonageTransport } from './adapters/vonage.js';
import type { TwilioHandlerConfig } from './twilio-handler.js';
import { TwilioMediaStreamHandler } from './twilio-handler.js';

export function createTwilioHandler(
  config?: Partial<TwilioHandlerConfig>,
): TwilioMediaStreamHandler {
  return new TwilioMediaStreamHandler(config);
}

export function createTelnyxTransport(config?: Partial<TelnyxTransportConfig>): TelnyxTransport {
  return new TelnyxTransport(config);
}

export function createSignalWireTransport(
  config?: Partial<SignalWireTransportConfig>,
): SignalWireTransport {
  return new SignalWireTransport(config);
}

export function createVonageTransport(config?: Partial<VonageTransportConfig>): VonageTransport {
  return new VonageTransport(config);
}

export type TelephonyTransportType = Extract<
  TransportType,
  'twilio' | 'telnyx' | 'signalwire' | 'vonage'
>;

export function createTransport(
  type: TransportType,
  config?: Partial<
    TwilioHandlerConfig | TelnyxTransportConfig | SignalWireTransportConfig | VonageTransportConfig
  >,
): Transport {
  switch (type) {
    case 'twilio':
      return createTwilioHandler(config as Partial<TwilioHandlerConfig>);
    case 'telnyx':
      return createTelnyxTransport(config as Partial<TelnyxTransportConfig>);
    case 'signalwire':
      return createSignalWireTransport(config as Partial<SignalWireTransportConfig>);
    case 'vonage':
      return createVonageTransport(config as Partial<VonageTransportConfig>);
    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}
