# Response Sanitization

## Capability

Cleans and transforms MCP agent responses for optimal text-to-speech output, removing SSML/Markdown markup, handling special characters, truncating overly long responses, and ensuring voice-friendly formatting.

## MCP Tools

| Tool | Input Schema | Output | Rate Limit |
|------|-------------|--------|------------|
| `sanitize.forTTS` | `z.object({ text: z.string(), options: SanitizeOptions.optional() })` | `{ sanitized: string, warnings: string[] }` | 1000 RPM |
| `sanitize.stripMarkdown` | `z.object({ text: z.string() })` | `{ text: string }` | 1000 RPM |
| `sanitize.stripSSML` | `z.object({ text: z.string() })` | `{ text: string }` | 1000 RPM |
| `sanitize.truncate` | `z.object({ text: z.string(), maxLength: z.number() })` | `{ text: string, truncated: boolean }` | 1000 RPM |
| `sanitize.validate` | `z.object({ text: z.string() })` | `{ valid: boolean, issues: string[] }` | 1000 RPM |

## Usage Examples

### Example 1: Sanitize response for TTS

- **User intent:** Clean MCP response before sending to TTS
- **Tool call:**
  ```json
  {
    "name": "sanitize.forTTS",
    "arguments": {
      "text": "I found **[3 articles](https://example.com)** about your query. The first one from *Nature* says..."
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "sanitized": "I found 3 articles about your query. The first one from Nature says...",
    "warnings": ["Removed markdown link syntax", "Removed italic markers"]
  }
  ```

### Example 2: Strip all Markdown formatting

- **User intent:** Remove all Markdown while preserving readable text
- **Tool call:**
  ```json
  {
    "name": "sanitize.stripMarkdown",
    "arguments": {
      "text": "Check out this **bold** and this *italic* text with [a link](https://example.com)"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "text": "Check out this bold and this italic text with a link"
  }
  ```

### Example 3: Strip SSML tags

- **User intent:** Remove SSML markup from response
- **Tool call:**
  ```json
  {
    "name": "sanitize.stripSSML",
    "arguments": {
      "text": "Hello <break time='500ms'/> welcome to <emphasis>our service</emphasis>"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "text": "Hello  welcome to our service"
  }
  ```

### Example 4: Truncate long response for voice

- **User intent:** Shorten response to fit voice time constraints
- **Tool call:**
  ```json
  {
    "name": "sanitize.truncate",
    "arguments": {
      "text": "Here are the main points from the article. First, climate change is affecting weather patterns globally. Second, renewable energy adoption is accelerating. Third, policy changes are needed...",
      "maxLength": 150
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "text": "Here are the main points from the article. First, climate change is affecting weather patterns globally. Second, renewable energy adoption is accelerating...",
    "truncated": true
  }
  ```

### Example 5: Validate text for TTS compatibility

- **User intent:** Check if text contains problematic characters
- **Tool call:**
  ```json
  {
    "name": "sanitize.validate",
    "arguments": {
      "text": "Your balance is $1,234.56 <special> and that's all"
    }
  }
  ```
- **Expected response:**
  ```json
  {
    "valid": false,
    "issues": [
      "Contains dollar sign (may cause TTS issues)",
      "Contains angle brackets (SSML characters)"
    ]
  }
  ```

## Error Handling

### Known Failure Modes

| Failure | Cause | Recovery |
|---------|-------|----------|
| Empty text | No content to sanitize | Return empty string |
| Invalid encoding | Non-UTF8 characters | Attempt to decode or reject |
| Unbalanced tags | Malformed SSML | Strip to balanced state |

### Recovery Strategies

- **Empty text:** Return empty string, no warning
- **Invalid encoding:** Replace invalid chars with placeholder
- **Unbalanced tags:** Use heuristic to balance or strip

## Security Considerations

### Content Filtering

```typescript
interface SanitizeOptions {
  removeUrls: boolean;           // Default: true
  removeEmails: boolean;         // Default: true
  removePhoneNumbers: boolean;    // Default: true
  removeSpecialChars: boolean;    // Default: false
  maxLength: number;              // Default: 500
}
```

### Dangerous Content Patterns

| Pattern | Example | Action |
|---------|---------|--------|
| URLs | `https://example.com` | Remove or spell out |
| Emails | `user@domain.com` | Remove or mask |
| Phone numbers | `+1-555-123-4567` | Remove or mask |
| SSML tags | `<break time='1s'/>` | Strip to plain text |
| Special chars | `&amp;` `&lt;` `&gt;` | Decode or remove |

## TTS Optimization

### Voice-Friendly Transformations

```typescript
// Before TTS
const optimizations: Record<string, string> = {
  // Expand abbreviations
  "Dr.": "Doctor",
  "Mr.": "Mister",
  "St.": "Street",

  // Fix common TTS issues (apply only to standalone symbols)
  " $": " dollars",
  " %": " percent",

  // Remove problematic characters
  "*": "",   // Markdown emphasis
  "#": "",   // Markdown headers
  "> ": "",   // Blockquotes (with trailing space to avoid mid-sentence)
};
```

### Sentence Chunking

```typescript
// Split long sentences for natural pacing
function chunkForVoice(text: string, maxLength: number = 200): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}
```

### Punctuation for Voice

```typescript
// Adjust punctuation for natural speech
function adjustPunctuation(text: string): string {
  return text
    // Replace colons with pauses
    .replace(/:/g, ", ")
    // Reduce multiple exclamation marks
    .replace(/!{2,}/g, "!")
    // Remove semicolons (confuse TTS)
    .replace(/;/g, ", ")
    // Handle parentheses (often mispronounced)
    .replace(/\(([^)]+)\)/g, "$1");
}
```

## Metrics and Observability

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `voice.sanitize.length_reduction` | Histogram | Characters removed |
| `voice.sanitize.truncated` | Counter | Truncation events |
| `voice.sanitize.warnings` | Counter | Sanitization warnings |
| `voice.sanitize.invalid` | Counter | Invalid input detected |

### Tracing

| Span | Attributes |
|------|------------|
| `voice.sanitize.full` | input_length, output_length, warnings_count |
| `voice.sanitize.truncate` | original_length, max_length, truncated |
| `voice.sanitize.strip` | pattern_type, replacements |

## Related Skills

- [TTS Provider Interface](../tts-provider-interface/skill.md)
- [MCP Client Integration](../mcp-client-integration/skill.md)
- [Pipeline Orchestration](../pipeline-orchestration/skill.md)