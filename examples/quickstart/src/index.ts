import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import type { AudioChunk, Pipeline, PipelineEvent } from '@reaatech/voice-agent-core';
import {
  createLatencyBudget,
  createPipeline,
  getDefaultSessionManager,
  LatencyBudgetEnforcer,
} from '@reaatech/voice-agent-core';
import { createMCPClient } from '@reaatech/voice-agent-mcp-client';
import { createSTTProvider } from '@reaatech/voice-agent-stt';
import { createTwilioHandler } from '@reaatech/voice-agent-telephony';
import { createTTSProvider } from '@reaatech/voice-agent-tts';
import Fastify from 'fastify';

import config from '../voice-agent-kit.config.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const sessionManager = getDefaultSessionManager();

interface CallStartInfo {
  callSid: string;
  streamSid: string;
  codec?: string;
  customParameters?: Record<string, string>;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyFormbody);
  await app.register(fastifyWebsocket);

  app.post('/incoming-call', async (request, reply) => {
    const host = request.headers.host || `localhost:${PORT}`;
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'ws' : 'wss';

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${protocol}://${host}/stream" />
  </Connect>
</Response>`;

    reply.header('Content-Type', 'text/xml');
    return twiml;
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      activeSessions: sessionManager.getActiveSessionCount(),
    };
  });

  app.get('/stream', { websocket: true }, (socket, _request) => {
    const sttProvider = createSTTProvider({
      provider: 'deepgram',
      config: config.stt,
    });

    const ttsProvider = createTTSProvider({
      provider: 'deepgram',
      config: config.tts,
    });

    const mcpClient = createMCPClient({
      endpoint: config.mcp.endpoint,
      auth: config.mcp.auth as
        | { type: 'bearer' | 'api-key' | 'oauth'; credentials: Record<string, string> }
        | undefined,
      timeout: config.mcp.timeout,
    });

    const latencyBudget = createLatencyBudget({
      target: config.latency.total.target,
      hardCap: config.latency.total.hardCap,
      stt: config.latency.stages.stt,
      mcp: config.latency.stages.mcp,
      tts: config.latency.stages.tts,
    });
    const latencyEnforcer = new LatencyBudgetEnforcer(latencyBudget);

    const handler = createTwilioHandler({
      bargeInEnabled: config.bargeIn.enabled,
      minSpeechDuration: config.bargeIn.minSpeechDuration,
      confidenceThreshold: config.bargeIn.confidenceThreshold,
      silenceThreshold: config.bargeIn.silenceThreshold,
    });

    const pipeline: Pipeline = createPipeline({
      sessionManager,
      latencyEnforcer,
      sttProvider,
      ttsProvider,
      mcpClient,
      config,
    });

    let sessionId: string | null = null;

    pipeline.on('pipeline:tts:start', () => {
      handler.setTTSPlaying(true);
    });

    pipeline.on('pipeline:tts:complete', () => {
      handler.setTTSPlaying(false);
    });

    pipeline.on('pipeline:tts:chunk', (event: PipelineEvent) => {
      const chunk = event.data?.chunk as AudioChunk | undefined;
      if (chunk) {
        handler.sendAudio(chunk);
      }
    });

    pipeline.on('pipeline:stt:interim', (event: PipelineEvent) => {
      const transcript = event.data?.transcript as string | undefined;
      const confidence = event.data?.confidence as number | undefined;
      if (transcript !== undefined && confidence !== undefined) {
        handler.onInterimTranscript(transcript, confidence);
      }
    });

    pipeline.on('pipeline:error', (event: PipelineEvent) => {
      app.log.error({ event }, 'Pipeline error');
    });

    handler.on('call:start', async (startInfo: CallStartInfo) => {
      const session = sessionManager.createSession({
        callSid: startInfo.callSid,
        mcpEndpoint: config.mcp.endpoint,
        sttProvider: config.stt.provider,
        ttsProvider: config.tts.provider,
        metadata: {
          streamSid: startInfo.streamSid,
          codec: startInfo.codec,
          customParameters: startInfo.customParameters,
        },
      });

      sessionId = session.sessionId;

      try {
        await pipeline.startSession({
          sessionId: session.sessionId,
          status: 'active',
        });
        app.log.info({ sessionId, callSid: startInfo.callSid }, 'Session started');
      } catch (error) {
        app.log.error({ error, sessionId }, 'Failed to start session');
      }
    });

    handler.on('audio:received', (chunk: AudioChunk) => {
      if (sessionId) {
        void pipeline.processAudioChunk(sessionId, chunk);
      }
    });

    handler.on('barge-in:detected', () => {
      if (sessionId) {
        pipeline.bargeIn(sessionId);
        void handler.clearAudio();
      }
    });

    handler.on('call:end', async () => {
      app.log.info({ sessionId }, 'Call ended');

      if (sessionId) {
        await pipeline.endSession(sessionId);
        sessionManager.closeSession(sessionId);
        sessionId = null;
      }

      pipeline.destroy();
    });

    handler.on('error', (error: Error) => {
      app.log.error({ error }, 'Twilio handler error');
    });

    void handler.acceptConnection(socket);
  });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Quickstart server listening on port ${PORT}`);
  } catch (error) {
    app.log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
