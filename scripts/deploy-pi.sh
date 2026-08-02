#!/usr/bin/env bash
# Build the Discord bot image for a Raspberry Pi and deploy it over SSH.
#
# Usage:
#   ./scripts/deploy-pi.sh pi@raspberrypi.local
#   PI_HOST=pi@raspberrypi.local ./scripts/deploy-pi.sh
#
# On Windows run it from Git Bash (`bash scripts/deploy-pi.sh pi@raspberrypi.local`);
# PowerShell does not understand the `VAR=value command` prefix form.
#
# Two build modes, picked automatically:
#   remote — the Pi builds its own image (local docker CLI driving the Pi's
#            engine over ssh). Native, no emulation. Needs a Pi with enough RAM
#            (a Pi 4/5 builds this in a few minutes; a Pi 3 will struggle).
#   local  — this machine cross-builds with buildx + QEMU and streams the image
#            to the Pi over ssh. Slower, but keeps the work off the Pi.
# Default: remote unless there is no reachable Pi engine, in which case local.
# Force with BUILD=remote or BUILD=local.
#
# Environment:
#   PI_HOST   ssh destination (or pass it as the first argument)
#   BUILD     remote | local (default: auto)
#   PLATFORM  local builds only — auto-detected from the Pi's `uname -m`
#             (linux/arm/v7 for 32-bit Raspberry Pi OS, linux/arm64 for 64-bit)
#   PI_DIR    deploy directory on the Pi (default: sc-trade-intel in $HOME)
#
# Requirements: docker CLI locally (a running local engine only for BUILD=local);
# docker + compose on the Pi. The first run copies .env.example to the Pi so you
# can fill in the tokens there — secrets are never baked into the image.
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

command -v docker >/dev/null 2>&1 || die "docker CLI not found on this machine."

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

# Everything copied to the Pi goes through `tr -d '\r'`: on Windows these files
# are checked out with CRLF, and a stray CR in .env becomes part of the token
# value (the bot then sees DISCORD_BOT_TOKEN="\r" and dies).
if [ "$COMPOSE" = "docker-compose" ]; then
  tr -d '\r' < docker-compose.yml | grep -v 'pull_policy' \
    | ssh "$PI_HOST" "cat > '$PI_DIR/docker-compose.yml'"
else
  tr -d '\r' < docker-compose.yml \
    | ssh "$PI_HOST" "cat > '$PI_DIR/docker-compose.yml'"
fi

if ! ssh "$PI_HOST" "test -f '$PI_DIR/.env'"; then
  tr -d '\r' < .env.example | ssh "$PI_HOST" "cat > '$PI_DIR/.env'"
  echo "    no .env on the Pi yet — copied the template to $PI_DIR/.env"
fi

# Which side builds? Building on the Pi is native (no QEMU); falling back to a
# local cross-build needs a running local engine.
if [ -z "${BUILD:-}" ]; then
  if DOCKER_HOST="ssh://$PI_HOST" docker version >/dev/null 2>&1; then
    BUILD=remote
  elif docker version >/dev/null 2>&1; then
    BUILD=local
  else
    die "no usable docker engine — the Pi's is unreachable and there is none running here."
  fi
fi

if [ "$BUILD" = remote ]; then
  echo "==> Building $IMAGE on the Pi (native; first build compiles better-sqlite3 — a few minutes)"
  export DOCKER_HOST="ssh://$PI_HOST"
  # Docker 20.10 on Raspberry Pi OS may not have BuildKit — fall back to the
  # classic builder, which ignores the Dockerfile's syntax directive.
  docker build -t "$IMAGE" . \
    || DOCKER_BUILDKIT=0 docker build -t "$IMAGE" . \
    || die "build failed on the Pi."
  unset DOCKER_HOST
else
  docker version >/dev/null 2>&1 \
    || die "BUILD=local needs a running docker engine here (start Docker Desktop)."
  docker buildx version >/dev/null 2>&1 \
    || die "docker buildx not available — needed to cross-build the Pi's image."

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

  echo "==> Cross-building $IMAGE for $PLATFORM (better-sqlite3 compiles under QEMU — expect several minutes)"
  echo "==> Streaming image to the Pi"
  docker buildx build --platform "$PLATFORM" -t "$IMAGE" -o type=docker,dest=- . \
    | gzip \
    | ssh "$PI_HOST" "gunzip | docker load"
fi

# Without this the next step would try to pull sc-trade-intel-bot from Docker
# Hub, where it does not exist ("pull access denied").
ssh "$PI_HOST" "docker image inspect '$IMAGE' >/dev/null 2>&1" \
  || die "$IMAGE is not on the Pi — not starting compose (it would try to pull it)."

# The image is built; the bot still needs its secrets before it can run.
# A value of whitespace only (e.g. a leftover CR) counts as empty here.
filled=$(ssh "$PI_HOST" "cd '$PI_DIR' && tr -d '\r' < .env | grep -Eo '^(UEX_API_TOKEN|ANTHROPIC_API_KEY|DISCORD_BOT_TOKEN)=[^[:space:]]+' | cut -d= -f1" || true)
missing=""
for var in UEX_API_TOKEN ANTHROPIC_API_KEY DISCORD_BOT_TOKEN; do
  printf '%s\n' "$filled" | grep -qx "$var" || missing="$missing $var"
done
if [ -n "$missing" ]; then
  echo "!! $IMAGE is ready on the Pi, but these are empty in $PI_HOST:$PI_DIR/.env:"
  echo "!!$missing"
  echo "   Fill them in (nano ~/$PI_DIR/.env on the Pi), then re-run this script"
  echo "   — the build is cached, so it will go straight to starting the bot."
  exit 1
fi

echo "==> Starting the bot"
ssh "$PI_HOST" "cd '$PI_DIR' && $COMPOSE up -d && $COMPOSE ps"

echo "==> Done. Logs: ssh $PI_HOST 'cd $PI_DIR && $COMPOSE logs -f'"
