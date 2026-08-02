#!/usr/bin/env bash
# Cross-build the Discord bot image for a Raspberry Pi 3 and deploy it over SSH.
#
# Usage:
#   ./scripts/deploy-pi.sh pi@raspberrypi.local
#   PI_HOST=pi@raspberrypi.local ./scripts/deploy-pi.sh
#
# On Windows run it from Git Bash (`bash scripts/deploy-pi.sh pi@raspberrypi.local`);
# PowerShell does not understand the `VAR=value command` prefix form.
#
# Environment:
#   PI_HOST   ssh destination (or pass it as the first argument)
#   PLATFORM  docker platform — auto-detected from the Pi's `uname -m`
#             (linux/arm/v7 for 32-bit Raspberry Pi OS, linux/arm64 for 64-bit)
#   PI_DIR    deploy directory on the Pi (default: sc-trade-intel in $HOME)
#
# Requirements: docker with buildx locally; docker + compose on the Pi. The
# first run copies .env.example to the Pi and stops so you can fill in the
# tokens there — secrets are never baked into the image.
set -euo pipefail

IMAGE=sc-trade-intel-bot:latest
PI_DIR=${PI_DIR:-sc-trade-intel}

die() { echo "!! $*" >&2; exit 1; }

PI_HOST=${1:-${PI_HOST:-}}
if [ -z "$PI_HOST" ]; then
  cat >&2 <<'EOF'
!! No Pi given. Pass the ssh destination as an argument:

     ./scripts/deploy-pi.sh pi@raspberrypi.local

   or export it first:

     export PI_HOST=pi@raspberrypi.local   # bash
     $env:PI_HOST = "pi@raspberrypi.local" # PowerShell
EOF
  exit 2
fi

command -v docker >/dev/null 2>&1 || die "docker not found on this machine."
docker buildx version >/dev/null 2>&1 \
  || die "docker buildx not available — needed to build the Pi's ARM image."

cd "$(dirname "$0")/.."

echo "==> Preparing $PI_HOST:$PI_DIR"
ssh "$PI_HOST" "mkdir -p '$PI_DIR'" \
  || die "cannot ssh into $PI_HOST. Check the hostname and your ssh key."

# The Pi may have compose v2 (docker compose) or the old standalone v1
# (docker-compose). They take the same file but v1 rejects pull_policy.
COMPOSE=$(ssh "$PI_HOST" 'if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  fi')
[ -n "$COMPOSE" ] \
  || die "no docker compose on the Pi. Install it: sudo apt install docker-compose-plugin"
echo "    compose on the Pi: $COMPOSE"

if [ "$COMPOSE" = "docker-compose" ]; then
  grep -v 'pull_policy' docker-compose.pi.yml \
    | ssh "$PI_HOST" "cat > '$PI_DIR/docker-compose.yml'"
else
  scp -q docker-compose.pi.yml "$PI_HOST:$PI_DIR/docker-compose.yml"
fi

if ! ssh "$PI_HOST" "test -f '$PI_DIR/.env'"; then
  scp -q .env.example "$PI_HOST:$PI_DIR/.env"
  echo "!! No .env on the Pi yet — copied .env.example to $PI_DIR/.env."
  echo "   Fill in UEX_API_TOKEN, ANTHROPIC_API_KEY and DISCORD_BOT_TOKEN"
  echo "   on the Pi, then re-run this script."
  exit 1
fi

# .env exists but may still be the blank template — the bot would crash-loop.
filled=$(ssh "$PI_HOST" "cd '$PI_DIR' && grep -Eo '^(UEX_API_TOKEN|ANTHROPIC_API_KEY|DISCORD_BOT_TOKEN)=..*' .env | cut -d= -f1" || true)
missing=""
for var in UEX_API_TOKEN ANTHROPIC_API_KEY DISCORD_BOT_TOKEN; do
  printf '%s\n' "$filled" | grep -qx "$var" || missing="$missing $var"
done
[ -z "$missing" ] || die "empty in $PI_HOST:$PI_DIR/.env —$missing"

if [ -z "${PLATFORM:-}" ]; then
  arch=$(ssh "$PI_HOST" 'uname -m')
  case "$arch" in
    aarch64|arm64) PLATFORM=linux/arm64 ;;
    armv7l|armv7*) PLATFORM=linux/arm/v7 ;;
    armv6l)        PLATFORM=linux/arm/v6 ;;
    *) die "unrecognised Pi architecture '$arch' — set PLATFORM explicitly." ;;
  esac
  echo "    Pi reports $arch -> building for $PLATFORM"
fi

echo "==> Building $IMAGE for $PLATFORM (first build compiles better-sqlite3 under QEMU — expect several minutes)"
echo "==> Streaming image to the Pi"
docker buildx build --platform "$PLATFORM" -t "$IMAGE" -o type=docker,dest=- . \
  | gzip \
  | ssh "$PI_HOST" "gunzip | docker load"

# Without this the next step would try to pull sc-trade-intel-bot from Docker
# Hub, where it does not exist ("pull access denied").
ssh "$PI_HOST" "docker image inspect '$IMAGE' >/dev/null 2>&1" \
  || die "$IMAGE did not load on the Pi — not starting compose (it would try to pull it)."

echo "==> Starting the bot"
ssh "$PI_HOST" "cd '$PI_DIR' && $COMPOSE up -d && $COMPOSE ps"

echo "==> Done. Logs: ssh $PI_HOST 'cd $PI_DIR && $COMPOSE logs -f'"
