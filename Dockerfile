FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy package manifests for dependency installation
COPY packages/core/package.json ./packages/core/
COPY packages/stt/package.json ./packages/stt/
COPY packages/tts/package.json ./packages/tts/
COPY packages/mcp-client/package.json ./packages/mcp-client/
COPY packages/telephony/package.json ./packages/telephony/

# Copy per-package tsconfig files
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/stt/tsconfig.json ./packages/stt/
COPY packages/tts/tsconfig.json ./packages/tts/
COPY packages/mcp-client/tsconfig.json ./packages/mcp-client/
COPY packages/telephony/tsconfig.json ./packages/telephony/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm -r build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy package manifests
COPY packages/core/package.json ./packages/core/
COPY packages/stt/package.json ./packages/stt/
COPY packages/tts/package.json ./packages/tts/
COPY packages/mcp-client/package.json ./packages/mcp-client/
COPY packages/telephony/package.json ./packages/telephony/

# Copy built outputs from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/stt/dist ./packages/stt/dist
COPY --from=builder /app/packages/tts/dist ./packages/tts/dist
COPY --from=builder /app/packages/mcp-client/dist ./packages/mcp-client/dist
COPY --from=builder /app/packages/telephony/dist ./packages/telephony/dist

# Copy node_modules
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node --eval "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))" || exit 1

CMD ["node", "packages/core/dist/index.js"]
