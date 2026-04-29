import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SessionManager,
  initializeSessionManager,
  getDefaultSessionManager,
} from '../src/session/index.js';
import type { Session } from '../src/types/index.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  const testOptions = {
    defaultTTL: 3600,
    maxTurns: 20,
    maxTokens: 4000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sessionManager = new SessionManager(testOptions);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionManager.destroy();
  });

  describe('createSession', () => {
    it('should create a new session with unique ID', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      expect(session.sessionId).toMatch(/^[a-f0-9-]{36}$/);
      expect(session.callSid).toBe('CA123');
      expect(session.mcpEndpoint).toBe('https://mcp.example.com');
      expect(session.sttProvider).toBe('deepgram');
      expect(session.ttsProvider).toBe('deepgram');
      expect(session.status).toBe('active');
      expect(session.turns).toEqual([]);
      expect(session.metadata).toEqual({});
    });

    it('should accept optional metadata', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
        metadata: { callerName: 'John' },
      });

      expect(session.metadata.callerName).toBe('John');
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', () => {
      const created = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });
      const retrieved = sessionManager.getSession(created.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionManager.getSession('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined for expired session', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      // Advance time past TTL
      vi.advanceTimersByTime(3601000);

      const result = sessionManager.getSession(session.sessionId);
      expect(result).toBeUndefined();
    });
  });

  describe('getSessionByCallSid', () => {
    it('should retrieve session by call SID', () => {
      sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const retrieved = sessionManager.getSessionByCallSid('CA123');
      expect(retrieved).toBeDefined();
      expect(retrieved?.callSid).toBe('CA123');
    });

    it('should return undefined for non-existent call SID', () => {
      const result = sessionManager.getSessionByCallSid('CA999');
      expect(result).toBeUndefined();
    });
  });

  describe('updateSession', () => {
    it('should update session properties', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const updated = sessionManager.updateSession(session.sessionId, {
        metadata: { twilioCallSid: 'CA456' },
      });

      expect(updated?.metadata.twilioCallSid).toBe('CA456');
    });

    it('should update lastActivityAt on update', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const before = session.lastActivityAt.getTime();
      vi.advanceTimersByTime(1000);

      sessionManager.updateSession(session.sessionId, { metadata: { test: true } });

      expect(session.lastActivityAt.getTime()).toBeGreaterThan(before);
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionManager.updateSession('non-existent-id', { metadata: {} });
      expect(result).toBeUndefined();
    });
  });

  describe('addTurn', () => {
    it('should add a turn to session', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const turn = sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Hello',
        agentResponse: 'Hi there!',
        latencyMs: 100,
      });

      expect(turn).toBeDefined();
      expect(turn?.turnId).toMatch(/^[a-f0-9-]{36}$/);
      expect(turn?.userUtterance).toBe('Hello');
      expect(turn?.agentResponse).toBe('Hi there!');
      expect(turn?.latencyMs).toBe(100);
    });

    it('should enforce maxTurns limit', () => {
      const smallTurnManager = new SessionManager({
        defaultTTL: 3600,
        maxTurns: 2,
        maxTokens: 1000,
      });

      const session = smallTurnManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      smallTurnManager.addTurn(session.sessionId, {
        userUtterance: 'Q1',
        agentResponse: 'A1',
        latencyMs: 100,
      });
      smallTurnManager.addTurn(session.sessionId, {
        userUtterance: 'Q2',
        agentResponse: 'A2',
        latencyMs: 100,
      });
      smallTurnManager.addTurn(session.sessionId, {
        userUtterance: 'Q3',
        agentResponse: 'A3',
        latencyMs: 100,
      });

      const updated = smallTurnManager.getSession(session.sessionId);
      expect(updated?.turns).toHaveLength(2);
      expect(updated?.turns[0]?.userUtterance).toBe('Q2');
      expect(updated?.turns[1]?.userUtterance).toBe('Q3');

      smallTurnManager.destroy();
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionManager.addTurn('non-existent-id', {
        userUtterance: 'Hello',
        agentResponse: 'Hi',
        latencyMs: 100,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('getConversationHistory', () => {
    it('should return all turns by default', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Q1',
        agentResponse: 'A1',
        latencyMs: 100,
      });
      sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Q2',
        agentResponse: 'A2',
        latencyMs: 100,
      });

      const history = sessionManager.getConversationHistory(session.sessionId);
      expect(history).toHaveLength(2);
    });

    it('should limit turns when maxTurns specified', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Q1',
        agentResponse: 'A1',
        latencyMs: 100,
      });
      sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Q2',
        agentResponse: 'A2',
        latencyMs: 100,
      });
      sessionManager.addTurn(session.sessionId, {
        userUtterance: 'Q3',
        agentResponse: 'A3',
        latencyMs: 100,
      });

      const history = sessionManager.getConversationHistory(session.sessionId, 2);
      expect(history).toHaveLength(2);
      expect(history[0]?.userUtterance).toBe('Q2');
      expect(history[1]?.userUtterance).toBe('Q3');
    });

    it('should return empty array for non-existent session', () => {
      const history = sessionManager.getConversationHistory('non-existent-id');
      expect(history).toEqual([]);
    });
  });

  describe('closeSession', () => {
    it('should close a session and update status', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const result = sessionManager.closeSession(session.sessionId);

      expect(result).toBe(true);
      expect(session.status).toBe('closed');
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.closeSession('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return count of active sessions', () => {
      sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });
      sessionManager.createSession({
        callSid: 'CA124',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      expect(sessionManager.getActiveSessionCount()).toBe(2);
    });

    it('should not count closed sessions', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      sessionManager.closeSession(session.sessionId);

      expect(sessionManager.getActiveSessionCount()).toBe(0);
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions', () => {
      sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });
      sessionManager.createSession({
        callSid: 'CA124',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('destroy', () => {
    it('should close all active sessions and clear', () => {
      const session = sessionManager.createSession({
        callSid: 'CA123',
        mcpEndpoint: 'https://mcp.example.com',
        sttProvider: 'deepgram',
        ttsProvider: 'deepgram',
      });

      sessionManager.destroy();

      expect(session.status).toBe('closed');
      expect(sessionManager.getAllSessions()).toHaveLength(0);
    });
  });
});

describe('getDefaultSessionManager', () => {
  it('should return a singleton instance', () => {
    const instance1 = getDefaultSessionManager();
    const instance2 = getDefaultSessionManager();

    expect(instance1).toBe(instance2);
  });
});

describe('initializeSessionManager', () => {
  it('should create a new instance and destroy old one', () => {
    const instance1 = getDefaultSessionManager();

    const newInstance = initializeSessionManager({
      defaultTTL: 7200,
      maxTurns: 30,
      maxTokens: 6000,
    });

    expect(newInstance).not.toBe(instance1);
    expect(newInstance.getActiveSessionCount()).toBe(0);
  });
});
