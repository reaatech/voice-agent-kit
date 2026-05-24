import type { AudioChunk, CallRecording, TurnRecord } from '../types/index.js';

const WAV_HEADER_SIZE = 44;

function writeWavHeader(
  dataLength: number,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Buffer {
  const buffer = Buffer.alloc(WAV_HEADER_SIZE);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertMulawToLinear16(mulawByte: number): number {
  const MULAW_BIAS = 0x84;
  const muLawDecompressTable = new Int16Array(256);

  for (let i = 0; i < 256; i++) {
    const complement = ~i & 0xff;
    const exponent = (complement >> 4) & 0x07;
    const mantissa = complement & 0x0f;
    let sample = (mantissa << 3) + MULAW_BIAS;
    sample <<= exponent;
    muLawDecompressTable[i] = complement > 0x7f ? MULAW_BIAS - sample : sample - MULAW_BIAS;
  }

  return muLawDecompressTable[mulawByte];
}

export function writeWavFile(chunks: AudioChunk[], sampleRate?: number): Buffer {
  if (chunks.length === 0) {
    const header = writeWavHeader(0, sampleRate ?? 8000, 1, 16);
    return header;
  }

  const sr = sampleRate ?? chunks[0].sampleRate;
  const channels = chunks[0].channels;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;

  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const encoding = chunk.encoding;

    if (encoding === 'linear16' || encoding === 'pcm') {
      if (chunk.sampleRate === sr) {
        audioBuffers.push(chunk.buffer);
      } else {
        const ratio = chunk.sampleRate / sr;
        const srcSamples = chunk.buffer;
        const srcNumSamples = Math.floor(srcSamples.length / bytesPerSample);
        const dstNumSamples = Math.floor(srcNumSamples / ratio);

        const output = Buffer.alloc(dstNumSamples * bytesPerSample);
        for (let i = 0; i < dstNumSamples; i++) {
          const srcIndex = Math.floor(i * ratio);
          const value = srcSamples.readInt16LE(srcIndex * bytesPerSample);
          output.writeInt16LE(value, i * bytesPerSample);
        }
        audioBuffers.push(output);
      }
    } else if (encoding === 'mulaw') {
      const samples = chunk.buffer.length;
      const output = Buffer.alloc(samples * bytesPerSample);

      for (let i = 0; i < samples; i++) {
        const linear = convertMulawToLinear16(chunk.buffer[i]);
        output.writeInt16LE(linear, i * bytesPerSample);
      }
      audioBuffers.push(output);
    }
  }

  const dataBuffer = Buffer.concat(audioBuffers);
  const header = writeWavHeader(dataBuffer.length, sr, channels, bitsPerSample);

  return Buffer.concat([header, dataBuffer]);
}

export function writeTranscriptFile(turns: TurnRecord[]): string {
  const lines: string[] = [];
  lines.push('# Call Transcript');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const turn of turns) {
    const duration = turn.endTime ? ((turn.endTime - turn.startTime) / 1000).toFixed(1) : '?';
    lines.push(`## Turn ${turn.turnId}`);
    lines.push(`Latency: ${turn.latencyMs}ms | Duration: ${duration}s`);
    lines.push('');
    lines.push(`**User**: ${turn.userUtterance}`);
    lines.push('');
    lines.push(`**Agent**: ${turn.agentResponse}`);
    lines.push('');

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      lines.push('### Tool Calls');
      for (const tc of turn.toolCalls) {
        lines.push(`- \`${tc.name}\``);
        if (tc.result) {
          lines.push(`  - Result: ${JSON.stringify(tc.result)}`);
        }
      }
      lines.push('');
    }

    if (turn.cost) {
      lines.push(`*Cost: ${turn.cost.currency} ${turn.cost.totalCost.toFixed(6)}*`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function writeSessionJson(recording: CallRecording): string {
  const serializable = {
    sessionId: recording.sessionId,
    callSid: recording.callSid,
    startTime: recording.startTime,
    endTime: recording.endTime ?? null,
    duration: recording.duration ?? null,
    turns: recording.turns.map((t) => ({
      turnId: t.turnId,
      userUtterance: t.userUtterance,
      agentResponse: t.agentResponse,
      startTime: t.startTime,
      endTime: t.endTime ?? null,
      latencyMs: t.latencyMs,
      toolCalls: t.toolCalls ?? [],
      cost: t.cost ?? null,
      userAudioFrames: t.userAudio?.length ?? 0,
      agentAudioFrames: t.agentAudio?.length ?? 0,
    })),
    events: recording.events.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      turnId: e.turnId ?? null,
      data: e.data ?? {},
    })),
    metadata: recording.metadata,
  };

  return JSON.stringify(serializable, null, 2);
}
