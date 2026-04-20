export interface TwilioStartMessage {
  event: 'start';
  start: {
    callSid: string;
    track: string;
    customParameters: Record<string, string>;
    codec: {
      payload_type: number;
      name: string;
      clock_rate: number;
    };
    streamSid?: string;
  };
}

export interface TwilioMediaMessage {
  event: 'media';
  streamSid: string;
  media: {
    payload: string;
    timestamp: string;
  };
  track: string;
}

export interface TwilioStopMessage {
  event: 'stop';
  streamSid?: string;
  stop: {
    callSid: string;
  };
}

export interface TwilioMarkMessage {
  event: 'mark';
  streamSid: string;
  mark: {
    name: string;
  };
}

export interface TwilioDTMFMessage {
  event: 'dtmf';
  streamSid: string;
  dtmf: {
    digit: string;
  };
}

export type TwilioMessage = TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage | TwilioMarkMessage | TwilioDTMFMessage;

export interface TwilioOutboundMessage {
  event: 'media' | 'clear' | 'mark' | 'start';
  streamSid?: string;
  media?: {
    payload: string;
  };
  mark?: {
    name: string;
  };
}

export interface TwilioStreamConfig {
  sampleRate: number;
  encoding: 'mulaw';
  channels: number;
  chunkDurationMs: number;
}
