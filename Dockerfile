# syntax=docker/dockerfile:1
# Discord bot image. Built for the Pi with:
#   docker buildx build --platform linux/arm/v7 .
# (scripts/deploy-pi.sh does this for you)

FROM node:20-bookworm-slim AS build
# better-sqlite3 ships no armv7 prebuilt binary — node-gyp compiles it from source
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    SC_TRADE_DB=/data/bot-cache.db
WORKDIR /app
# package.json is needed at runtime for "type": "module"
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "dist/bot/index.js"]
