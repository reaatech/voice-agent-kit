import { describe, expect, it } from 'vitest';
import {
  createTransport,
  createTwilioHandler,
  createTelnyxTransport,
  createSignalWireTransport,
  createVonageTransport,
} from '../src/factory.js';
import { TwilioMediaStreamHandler } from '../src/twilio-handler.js';
import { TelnyxTransport } from '../src/adapters/telnyx.js';
import { SignalWireTransport } from '../src/adapters/signalwire.js';
import { VonageTransport } from '../src/adapters/vonage.js';

describe('Telephony Factory', () => {
  describe('createTransport', () => {
    it('should create TwilioMediaStreamHandler for twilio type', () => {
      const transport = createTransport('twilio');
      expect(transport).toBeInstanceOf(TwilioMediaStreamHandler);
      expect(transport.name).toBe('twilio');
    });

    it('should create TelnyxTransport for telnyx type', () => {
      const transport = createTransport('telnyx');
      expect(transport).toBeInstanceOf(TelnyxTransport);
      expect(transport.name).toBe('telnyx');
    });

    it('should create SignalWireTransport for signalwire type', () => {
      const transport = createTransport('signalwire');
      expect(transport).toBeInstanceOf(SignalWireTransport);
      expect(transport.name).toBe('signalwire');
    });

    it('should create VonageTransport for vonage type', () => {
      const transport = createTransport('vonage');
      expect(transport).toBeInstanceOf(VonageTransport);
      expect(transport.name).toBe('vonage');
    });

    it('should pass config to transport constructor', () => {
      const transport = createTransport('twilio', { bargeInEnabled: true });
      expect((transport as TwilioMediaStreamHandler).isBargeInEnabled()).toBe(true);
    });

    it('should throw for unknown transport type', () => {
      expect(() =>
        createTransport('unknown' as any),
      ).toThrow('Unknown transport type: unknown');
    });
  });

  describe('createTwilioHandler', () => {
    it('should create TwilioMediaStreamHandler with defaults', () => {
      const handler = createTwilioHandler();
      expect(handler).toBeInstanceOf(TwilioMediaStreamHandler);
      expect(handler.name).toBe('twilio');
    });

    it('should create TwilioMediaStreamHandler with config', () => {
      const handler = createTwilioHandler({ bargeInEnabled: true });
      expect(handler.isBargeInEnabled()).toBe(true);
    });
  });

  describe('createTelnyxTransport', () => {
    it('should create TelnyxTransport with defaults', () => {
      const transport = createTelnyxTransport();
      expect(transport).toBeInstanceOf(TelnyxTransport);
      expect(transport.name).toBe('telnyx');
    });

    it('should create TelnyxTransport with config', () => {
      const transport = createTelnyxTransport({ bargeInEnabled: true });
      expect(transport.isBargeInEnabled()).toBe(true);
    });
  });

  describe('createSignalWireTransport', () => {
    it('should create SignalWireTransport with defaults', () => {
      const transport = createSignalWireTransport();
      expect(transport).toBeInstanceOf(SignalWireTransport);
      expect(transport.name).toBe('signalwire');
    });

    it('should create SignalWireTransport with config', () => {
      const transport = createSignalWireTransport({ bargeInEnabled: true });
      expect(transport.isBargeInEnabled()).toBe(true);
    });
  });

  describe('createVonageTransport', () => {
    it('should create VonageTransport with defaults', () => {
      const transport = createVonageTransport();
      expect(transport).toBeInstanceOf(VonageTransport);
      expect(transport.name).toBe('vonage');
    });

    it('should create VonageTransport with config', () => {
      const transport = createVonageTransport({ bargeInEnabled: true });
      expect(transport.isBargeInEnabled()).toBe(true);
    });
  });
});
