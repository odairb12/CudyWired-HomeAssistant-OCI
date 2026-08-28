#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_DIR="${LEGACY_DIR:-/opt/home-automation}"
ENV_FILE="$PROJECT_ROOT/.env"

log() {
  printf '\n============================================================\n%s\n============================================================\n' "$1"
}

die() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || die "Run with: sudo ./scripts/migrate-legacy-layout.sh"
[[ -d "$LEGACY_DIR" ]] || die "Legacy directory not found: $LEGACY_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATA_DIR="${DATA_DIR:-/srv/home-automation}"
[[ "$DATA_DIR" != "$LEGACY_DIR" ]] || die "DATA_DIR and LEGACY_DIR are the same path."

log "Stop legacy stack"
if [[ -f "$LEGACY_DIR/compose.yaml" ]]; then
  docker compose -f "$LEGACY_DIR/compose.yaml" down || true
elif [[ -f "$LEGACY_DIR/docker-compose.yml" ]]; then
  docker compose -f "$LEGACY_DIR/docker-compose.yml" down || true
else
  echo "No legacy Compose file found; continuing with copy only."
fi

log "Install rsync"
if ! command -v rsync >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y rsync
fi

log "Copy persistent data"
install -d -m 0755 "$DATA_DIR"

for name in homeassistant portainer wireguard mosquitto nodered esphome zigbee2mqtt backups; do
  if [[ -d "$LEGACY_DIR/$name" ]]; then
    echo "Migrating $name/"
    install -d -m 0755 "$DATA_DIR/$name"
    rsync -aH --numeric-ids "$LEGACY_DIR/$name/" "$DATA_DIR/$name/"
  fi
done

log "Validation"
if [[ -d "$LEGACY_DIR/homeassistant/config" ]]; then
  [[ -d "$DATA_DIR/homeassistant/config" ]] || die "Home Assistant config was not copied."
fi

if [[ -d "$LEGACY_DIR/wireguard/config" ]]; then
  [[ -d "$DATA_DIR/wireguard/config" ]] || die "WireGuard config was not copied."
fi

cat <<MSG
Migration copy completed.

Source was preserved:
  $LEGACY_DIR

New persistent data path:
  $DATA_DIR

Next step:
  cd $PROJECT_ROOT
  sudo ./scripts/setup-home.sh

After validating Home Assistant, WireGuard handshake and Cudy access, the legacy
folder can be archived or removed manually. Do not delete it before validation.
MSG
