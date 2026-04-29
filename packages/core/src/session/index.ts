import { v4 as uuidv4 } from 'uuid';

import type { Session, Turn, SessionConfig } from '../types/index.js';

export interface SessionManagerOptions {
  defaultTTL: number;
  maxTurns: number;
  maxTokens: number;
  cleanupInterval?: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private readonly options: SessionManagerOptions;

  constructor(options: SessionManagerOptions) {
    this.options = options;
    this.startCleanupTimer();
  }

  createSession(params: {
    callSid: string;
    mcpEndpoint: string;
    sttProvider: string;
    ttsProvider: string;
    metadata?: Record<string, unknown>;
  }): Session {
    const sessionId = uuidv4();
    const now = new Date();

    const session: Session = {
      sessionId,
      callSid: params.callSid,
      mcpEndpoint: params.mcpEndpoint,
      sttProvider: params.sttProvider,
      ttsProvider: params.ttsProvider,
      turns: [],
      createdAt: now,
      lastActivityAt: now,
      ttl: this.options.defaultTTL,
      metadata: params.metadata ?? {},
      status: 'active',
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);

    if (session && this.isSessionExpired(session)) {
      this.closeSession(sessionId);
      return undefined;
    }

    return session;
  }

  getSessionByCallSid(callSid: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.callSid === callSid && session.status === 'active') {
        if (this.isSessionExpired(session)) {
          this.closeSession(session.sessionId);
          return undefined;
        }
        return session;
      }
    }
    return undefined;
  }

  updateSession(sessionId: string, updates: Partial<Session>): Session | undefined {
    const session = this.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    Object.assign(session, updates);
    session.lastActivityAt = new Date();

    return session;
  }

  addTurn(sessionId: string, turn: Omit<Turn, 'turnId'>): Turn | undefined {
    const session = this.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    const turnWithId: Turn = {
      ...turn,
      turnId: uuidv4(),
    };

    session.turns.push(turnWithId);
    session.lastActivityAt = new Date();

    // Enforce max turns limit
    if (session.turns.length > this.options.maxTurns) {
      session.turns = session.turns.slice(-this.options.maxTurns);
    }

    return turnWithId;
  }

  getConversationHistory(sessionId: string, maxTurns?: number): Turn[] {
    const session = this.getSession(sessionId);

    if (!session) {
      return [];
    }

    const limit = maxTurns ?? this.options.maxTurns;
    return session.turns.slice(-limit);
  }

  closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.status = 'closed';
    session.lastActivityAt = new Date();

    // Remove after a short delay to allow for final cleanup
    const timer = setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 5000);
    timer.unref?.();

    return true;
  }

  getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && !this.isSessionExpired(session)) {
        count++;
      }
    }
    return count;
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  private isSessionExpired(session: Session): boolean {
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - session.lastActivityAt.getTime()) / 1000);
    return elapsed > session.ttl;
  }

  private startCleanupTimer() {
    const interval = this.options.cleanupInterval ?? 60000; // Default: 1 minute

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, interval);

    // Don't let the timer prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupExpiredSessions() {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status === 'closed' || this.isSessionExpired(session)) {
        this.sessions.delete(sessionId);
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Close all active sessions
    for (const [_sessionId, session] of this.sessions.entries()) {
      if (session.status === 'active') {
        session.status = 'closed';
      }
    }

    this.sessions.clear();
  }
}

// Default session manager instance
let defaultSessionManager: SessionManager | undefined;

export function getDefaultSessionManager(): SessionManager {
  if (!defaultSessionManager) {
    const config: SessionConfig = {
      ttl: 3600,
      history: {
        maxTurns: 20,
        maxTokens: 4000,
      },
    };

    defaultSessionManager = new SessionManager({
      defaultTTL: config.ttl,
      maxTurns: config.history.maxTurns,
      maxTokens: config.history.maxTokens,
    });
  }

  return defaultSessionManager;
}

export function initializeSessionManager(options: SessionManagerOptions): SessionManager {
  if (defaultSessionManager) {
    defaultSessionManager.destroy();
  }

  defaultSessionManager = new SessionManager(options);
  return defaultSessionManager;
}
