# The Vanity voice server as a container (for Fly.io, Render, Railway, a VPS…).
# Build it from the repository's top folder, because it shares one file with the app:
#   docker build -f server/voice/Dockerfile -t vanity-voice .
#   docker run -p 8787:8787 --env-file server/voice/.env vanity-voice
FROM node:22-alpine AS build
WORKDIR /app
COPY src/shared/voiceProtocol.ts src/shared/voiceProtocol.ts
COPY server/voice/package.json server/voice/package-lock.json server/voice/
RUN cd server/voice && npm ci --no-audit --no-fund
COPY server/voice/src server/voice/src
COPY server/voice/tsconfig.json server/voice/
RUN cd server/voice && npm run build

FROM node:22-alpine
WORKDIR /app
# One file, no packages needed at run time.
COPY --from=build /app/server/voice/dist/voice-server.mjs ./
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node", "voice-server.mjs"]
