# Audio Format Conversion

## Capability

Handles audio encoding and decoding between various formats (mulaw, linear16, PCM) and sample rates, enabling interoperability between Twilio (mulaw 8kHz) and STT/TTS providers that may use different audio formats.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `audio.decode` | `z.object({ data: z.instanceof(Buffer), fromEncoding: z.enum(['mulaw', 'linear16', 'pcm']), toEncoding: z.enum(['mulaw', 'linear16', 'pcm']), sampleRate: z.number() })` | `{ audio: Buffer, encoding: string, sampleRate: number }` | 1000 RPM |
| `audio.resample` | `z.object({ data: z.instanceof(Buffer), fromSampleRate: z.number(), toSampleRate: z.number() })` | `{ audio: Buffer, sampleRate: number }` | 1000 RPM |
| `audio.encode` | `z.object({ data: z.instanceof(Buffer), encoding: z.enum(['mulaw', 'linear16', 'pcm']), sampleRate: z.number() })` | `{ data: Buffer }` | 1000 RPM |
| `audio.validate` | `z.object({ data: z.instanceof(Buffer), expectedEncoding: z.string(), expectedSampleRate: z.number() })` | `{ valid: boolean, detected?: { encoding: string, sampleRate: number } }` | 100 RPM |

## Usage Examples

### Example 1: Convert Twilio mulaw to linear16 for STT

- **User intent:** Convert inbound Twilio audio for provider that requires linear16
- **Tool call:**
  ```json
  {
    "name": "audio.decode",
    "arguments": {
      "data": "<Buffer mulaw 8kHz>",
      "fromEncoding": "mulaw",
      "toEncoding": "linear16",
      "sampleRate": 8000
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "audio": "<Buffer linear16 8kHz>",
    "encoding": "linear16",
    "sampleRate": 8000
  }
  ```

### Example 2: Resample audio from 16kHz to 8kHz

- **User intent:** Downsample high-sample-rate audio for Twilio
- **Tool call:**
  ```json
  {
    "name": "audio.resample",
    "arguments": {
      "data": "<Buffer 16kHz audio>",
      "fromSampleRate": 16000,
      "toSampleRate": 8000
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "audio": "<Buffer 8kHz audio>",
    "sampleRate": 8000
  }
  ```

### Example 3: Encode audio to Twilio format

- **User intent:** Convert TTS output to Twilio-compatible mulaw 8kHz
- **Tool call:**
  ```json
  {
    "name": "audio.encode",
    "arguments": {
      "data": "<Buffer PCM 24kHz from Deepgram>",
      "encoding": "mulaw",
      "sampleRate": 8000
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "data": "<Buffer mulaw 8kHz>"
  }
  ```

### Example 4: Validate audio format

- **User intent:** Check if audio matches expected format
- **Tool call:**
  ```json
  {
    "name": "audio.validate",
    "arguments": {
      "data": "<Buffer audio>",
      "expectedEncoding": "mulaw",
      "expectedSampleRate": 8000
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "valid": true
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Invalid encoding | Unknown format | Return error with supported formats |
| Sample rate mismatch | Unexpected sample rate | Auto-detect or return error |
| Buffer too small | Incomplete audio chunk | Pad with silence or return error |
| Conversion overflow | Values out of range | Clamp values, log warning |
| Memory exhaustion | Very large buffer | Process in chunks, return error if too large |

### Recovery Strategies

- **Format errors:** Return original buffer with error, let caller decide
- **Sample rate detection:** Use audio metadata or heuristic detection
- **Large buffers:** Process in 20ms chunks to limit memory usage

## Security Considerations

### PII Handling

- Never log raw audio content
- Do not store converted audio unless explicitly configured
- Process audio in-memory without disk persistence

### Permissions

- Audio conversion is a local operation (no external API calls)
- Rate limit to prevent CPU exhaustion
- Validate buffer sizes to prevent memory attacks

### Audit Logging

- Log conversion operations (format, sample rate, duration)
- Track conversion errors by type
- Record performance metrics (conversion time)

## Audio Format Specifications

### Mulaw (µ-law)

- **Type:** Lossy companded audio
- **Bit depth:** 8 bits per sample
- **Dynamic range:** ~14 bits (companded)
- **Common sample rates:** 8000 Hz (telephony)
- **Use case:** Twilio, PSTN, legacy telephony

### Linear16 (PCM 16-bit)

- **Type:** Uncompressed PCM
- **Bit depth:** 16 bits per sample
- **Dynamic range:** 96 dB
- **Common sample rates:** 8000, 16000, 22050, 44100, 48000 Hz
- **Use case:** Most STT/TTS providers

### PCM (Generic)

- **Type:** Uncompressed PCM
- **Bit depth:** 8, 16, 24, or 32 bits
- **Endianness:** Little-endian (typically)
- **Use case:** Raw audio from various sources

## Conversion Matrix

| From → To | Mulaw 8k | Linear16 8k | Linear16 16k | Linear16 24k | Linear16 48k |
|-----------|----------|-------------|--------------|--------------|--------------|
| Mulaw 8k | — | Decode | Resample+Decode | Resample+Decode | Resample+Decode |
| Linear16 8k | Encode | — | Resample | Resample | Resample |
| Linear16 16k | Resample+Encode | Resample | — | Resample | Resample |
| Linear16 24k | Resample+Encode | Resample | Resample | — | Resample |
| Linear16 48k | Resample+Encode | Resample | Resample | Resample | — |

## Performance Considerations

### Conversion Latency

| Operation | Typical Latency (per 20ms chunk) |
|-----------|----------------------------------|
| Mulaw ↔ Linear16 | < 1ms |
| Resample (2x) | < 2ms |
| Resample (3x, 6x) | < 5ms |

### Memory Usage

- **Mulaw:** 1 byte per sample (8000 Hz = 160 bytes per 20ms)
- **Linear16:** 2 bytes per sample (8000 Hz = 320 bytes per 20ms)
- **Linear16 16k:** 2 bytes per sample (16000 Hz = 640 bytes per 20ms)

### Optimization Tips

1. **Batch conversions** — Convert multiple chunks together when possible
2. **Use native bindings** — Use optimized native libraries for resampling
3. **Cache conversion state** — Reuse resampler instances across chunks
4. **Stream processing** — Process audio in small chunks to minimize latency

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `audio.conversions.total` | Counter | Total conversions performed |
| `audio.conversions.errors` | Counter | Conversion errors |
| `audio.conversions.latency_ms` | Histogram | Conversion latency |
| `audio.resampling.total` | Counter | Resampling operations |

### Tracing

| Span | Attributes |
|------|------------|
| `audio.decode` | from_encoding, to_encoding, sample_rate, buffer_size |
| `audio.resample` | from_rate, to_rate, buffer_size |
| `audio.encode` | encoding, sample_rate, buffer_size |

## Related Skills

- [STT Provider Interface](../stt-provider-interface/skill.md)
- [TTS Provider Interface](../tts-provider-interface/skill.md)
- [Twilio Media Streams](../twilio-media-streams/skill.md)
