#!/usr/bin/env bash
# Cross-build the Discord bot image for a Raspberry Pi 3 and deploy it over SSH.
#
# Usage:
#   PI_HOST=pi@raspberrypi.local ./scripts/deploy-pi.sh
#
# Environment:
#   PI_HOST   ssh destination (required), e.g. pi@raspberrypi.local
#   PLATFORM  docker platform (default linux/arm/v7 for 32-bit Raspberry Pi OS;
#             set linux/arm64 if the Pi runs the 64-bit OS)
#   PI_DIR    deploy directory on the Pi (default: sc-trade-intel in $HOME)
#
# Requirements: docker with buildx locally; docker + the compose plugin on the
# Pi. The first run copies .env.example to the Pi and stops so you can fill in
# the tokens there — secrets are never baked into the image.
set -euo pipefail

PI_HOST=${PI_HOST:?set PI_HOST, e.g. PI_HOST=pi@raspberrypi.local}
PLATFORM=${PLATFORM:-linux/arm/v7}
PI_DIR=${PI_DIR:-sc-trade-intel}
IMAGE=sc-trade-intel-bot:latest

cd "$(dirname "$0")/.."

echo "==> Preparing $PI_HOST:$PI_DIR"
ssh "$PI_HOST" "mkdir -p '$PI_DIR'"
scp -q docker-compose.pi.yml "$PI_HOST:$PI_DIR/docker-compose.yml"

if ! ssh "$PI_HOST" "test -f '$PI_DIR/.env'"; then
  scp -q .env.example "$PI_HOST:$PI_DIR/.env"
  echo "!! No .env on the Pi yet — copied .env.example to $PI_DIR/.env."
  echo "   Fill in UEX_API_TOKEN, ANTHROPIC_API_KEY and DISCORD_BOT_TOKEN"
  echo "   on the Pi, then re-run this script."
  exit 1
fi

echo "==> Building $IMAGE for $PLATFORM (first build compiles better-sqlite3 under QEMU — expect several minutes)"
echo "==> Streaming image to the Pi"
docker buildx build --platform "$PLATFORM" -t "$IMAGE" -o type=docker,dest=- . \
  | gzip \
  | ssh "$PI_HOST" "gunzip | docker load"

echo "==> Starting the bot"
ssh "$PI_HOST" "cd '$PI_DIR' && docker compose up -d && docker compose ps"

echo "==> Done. Logs: ssh $PI_HOST 'cd $PI_DIR && docker compose logs -f'"
