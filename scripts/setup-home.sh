#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
DATA_DIR_DEFAULT="/srv/home-automation"

log() {
  printf '\n============================================================\n%s\n============================================================\n' "$1"
}

die() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || die "Run with: sudo ./scripts/setup-home.sh"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Supported target: Ubuntu 24.04 Minimal."
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATA_DIR="${DATA_DIR:-$DATA_DIR_DEFAULT}"
TZ="${TZ:-America/Sao_Paulo}"

log "[1/10] System packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl wget gnupg git jq vim htop iproute2 iptables openssh-server

timedatectl set-timezone "$TZ"
systemctl enable --now ssh

log "[2/10] 2 GB swap"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

log "[3/10] Kernel settings"
cat >/etc/sysctl.d/99-homeautomation.conf <<'SYSCTL'
vm.swappiness=10
vm.vfs_cache_pressure=50
net.ipv4.ip_forward=1
SYSCTL
sysctl -p /etc/sysctl.d/99-homeautomation.conf

log "[4/10] Docker Engine and Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
id ubuntu >/dev/null 2>&1 && usermod -aG docker ubuntu || true

docker --version
docker compose version

log "[5/10] Persistent data directories"
install -d -m 0755 \
  "$DATA_DIR/homeassistant/config" \
  "$DATA_DIR/portainer/data" \
  "$DATA_DIR/wireguard/config" \
  "$DATA_DIR/mosquitto/data" \
  "$DATA_DIR/mosquitto/log" \
  "$DATA_DIR/nodered/data" \
  "$DATA_DIR/esphome/config" \
  "$DATA_DIR/zigbee2mqtt/data" \
  "$DATA_DIR/backups"

chown -R 1000:1000 "$DATA_DIR/wireguard" "$DATA_DIR/nodered" "$DATA_DIR/zigbee2mqtt"
chown -R 1883:1883 "$DATA_DIR/mosquitto"

log "[6/10] Persistent host firewall service"
install -m 0755 "$PROJECT_ROOT/scripts/configure-host-firewall.sh" /usr/local/sbin/home-automation-firewall
install -m 0644 "$PROJECT_ROOT/systemd/home-automation-firewall.service" /etc/systemd/system/home-automation-firewall.service
systemctl daemon-reload
systemctl enable --now home-automation-firewall.service

log "[7/10] Compose validation"
cd "$PROJECT_ROOT"
docker compose config -q
echo "compose.yaml: OK"

log "[8/10] Pull core images"
docker compose pull homeassistant portainer wireguard

log "[9/10] Start core services"
docker compose up -d homeassistant portainer wireguard

log "[10/10] Wait for Home Assistant"
HA_READY=0
for i in $(seq 1 60); do
  if curl -fsS --connect-timeout 2 http://127.0.0.1:8123 >/dev/null 2>&1; then
    HA_READY=1
    echo "Home Assistant: OK"
    break
  fi
  echo "Waiting for Home Assistant... $i/60"
  sleep 5
done

if [[ "$HA_READY" -ne 1 ]]; then
  echo "WARNING: Home Assistant did not answer within 5 minutes."
  docker logs --tail 100 homeassistant || true
fi

"$PROJECT_ROOT/scripts/validate.sh" || true

CUDY_CONFIG="$DATA_DIR/wireguard/config/peer_cudy/peer_cudy.conf"
printf '\n============================================================\nSETUP COMPLETE\n============================================================\n'
echo "Home Assistant via VPN: http://10.13.13.1:8123"
echo "SSH via VPN:            ssh ubuntu@10.13.13.1"
echo "Portainer via VPN:      https://10.13.13.1:9443"
echo "WireGuard public port:  UDP/${WG_SERVER_PORT:-51820}"
echo "Persistent data:        $DATA_DIR"
echo
echo "OCI normally needs only UDP/${WG_SERVER_PORT:-51820} exposed publicly."
echo "Open TCP/22, TCP/8123 or TCP/9443 in OCI temporarily when required."

if [[ -f "$CUDY_CONFIG" ]]; then
  echo
  echo "Cudy peer config: $CUDY_CONFIG"
  echo "This file contains a private key. Do not commit or share it."
else
  echo
  echo "Cudy peer config is not present yet. Check: docker logs wireguard"
fi
