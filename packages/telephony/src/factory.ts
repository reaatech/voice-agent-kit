import type { TwilioHandlerConfig } from './twilio-handler.js';
import { TwilioMediaStreamHandler } from './twilio-handler.js';

export function createTwilioHandler(
  config?: Partial<TwilioHandlerConfig>,
): TwilioMediaStreamHandler {
  return new TwilioMediaStreamHandler(config);
}
