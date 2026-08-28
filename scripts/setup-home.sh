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
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
else
  chmod 600 "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATA_DIR="${DATA_DIR:-$DATA_DIR_DEFAULT}"
TZ="${TZ:-America/Sao_Paulo}"
WG_ALLOWED_IPS_VALUE="${WG_ALLOWED_IPS:-10.99.0.1/32}"
WG_SERVER_IP="${WG_ALLOWED_IPS_VALUE%%/*}"

log "[1/12] System packages and unattended security updates"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl wget gnupg git jq vim htop iproute2 iputils-ping iptables \
  openssh-server unattended-upgrades nftables

timedatectl set-timezone "$TZ"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'APTCONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APTCONF
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true
systemctl enable --now ssh

log "[2/12] SSH hardening"
AUTHORIZED_KEY_FOUND=0
while IFS= read -r keyfile; do
  if [[ -s "$keyfile" ]]; then
    AUTHORIZED_KEY_FOUND=1
    break
  fi
done < <(find /root /home -maxdepth 3 -type f -name authorized_keys 2>/dev/null || true)

if [[ "$AUTHORIZED_KEY_FOUND" -eq 1 ]]; then
  install -d -m 0755 /etc/ssh/sshd_config.d
  cat >/etc/ssh/sshd_config.d/99-home-automation-hardening.conf <<'SSHCONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding yes
PermitTunnel no
UseDNS no
SSHCONF
  sshd -t
  systemctl reload ssh
else
  echo "WARNING: no authorized_keys found; password authentication was not disabled to avoid lockout."
fi

log "[3/12] 2 GB swap"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

log "[4/12] Kernel network hardening"
cat >/etc/sysctl.d/99-homeautomation.conf <<'SYSCTL'
vm.swappiness=10
vm.vfs_cache_pressure=50
net.ipv4.ip_forward=1
net.ipv4.conf.all.src_valid_mark=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net.ipv4.conf.all.accept_source_route=0
net.ipv4.conf.default.accept_source_route=0
net.ipv4.conf.all.log_martians=1
net.ipv6.conf.all.accept_redirects=0
net.ipv6.conf.default.accept_redirects=0
net.ipv6.conf.all.accept_source_route=0
net.ipv6.conf.default.accept_source_route=0
SYSCTL
sysctl -p /etc/sysctl.d/99-homeautomation.conf

log "[5/12] Docker Engine and Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Membership in the docker group is root-equivalent. Keep it disabled unless the
# operator explicitly opts in. Existing membership is removed by default.
if id ubuntu >/dev/null 2>&1; then
  if [[ "${ALLOW_DOCKER_GROUP:-false}" == "true" ]]; then
    usermod -aG docker ubuntu
  else
    gpasswd -d ubuntu docker >/dev/null 2>&1 || true
  fi
fi

docker --version
docker compose version

log "[6/12] Persistent data directories and secret migration"
install -d -m 0750 \
  "$DATA_DIR/homeassistant/config" \
  "$DATA_DIR/portainer/data" \
  "$DATA_DIR/wireguard/config" \
  "$DATA_DIR/cudy-alexa/data" \
  "$DATA_DIR/caddy/data" \
  "$DATA_DIR/caddy/config" \
  "$DATA_DIR/mosquitto/data" \
  "$DATA_DIR/mosquitto/log" \
  "$DATA_DIR/nodered/data" \
  "$DATA_DIR/esphome/config" \
  "$DATA_DIR/zigbee2mqtt/data"
install -d -m 0700 "$DATA_DIR/secrets" "$DATA_DIR/backups"

chown -R 1000:1000 "$DATA_DIR/wireguard" "$DATA_DIR/cudy-alexa" "$DATA_DIR/nodered" "$DATA_DIR/zigbee2mqtt"
chown -R 1883:1883 "$DATA_DIR/mosquitto"

HA_TOKEN_FILE="$DATA_DIR/secrets/ha_token"
if [[ -n "${HA_TOKEN:-}" && "${HA_TOKEN:-}" != "CHANGE_ME" ]]; then
  printf '%s' "$HA_TOKEN" >"$HA_TOKEN_FILE"
  # Remove the long-lived token from .env after migrating it to a file mount.
  sed -i '/^HA_TOKEN=/d' "$ENV_FILE"
elif [[ ! -f "$HA_TOKEN_FILE" ]]; then
  install -m 0600 /dev/null "$HA_TOKEN_FILE"
  echo "WARNING: $HA_TOKEN_FILE is empty; configure a dedicated non-admin Home Assistant token before starting Alexa."
fi

# The Alexa image runs as UID 1000. Docker performs the bind mount as root, but
# the process still needs read permission on the mounted file. Grant ownership
# only to that runtime UID and no permissions to group/others.
chown 1000:1000 "$HA_TOKEN_FILE"
chmod 0400 "$HA_TOKEN_FILE"

log "[7/12] Persistent host firewall service"
install -d -m 0750 /etc/home-automation
cat >/etc/home-automation/firewall.env <<EOF
WG_INTERFACE=wg0
WG_SERVER_PORT=${WG_SERVER_PORT:-51820}
SSH_PUBLIC_CIDR=${SSH_PUBLIC_CIDR:-}
EOF
chmod 600 /etc/home-automation/firewall.env
install -m 0755 "$PROJECT_ROOT/scripts/configure-host-firewall.sh" /usr/local/sbin/home-automation-firewall
install -m 0644 "$PROJECT_ROOT/systemd/home-automation-firewall.service" /etc/systemd/system/home-automation-firewall.service
systemctl daemon-reload
systemctl enable home-automation-firewall.service
systemctl restart home-automation-firewall.service

log "[8/12] Compose validation"
cd "$PROJECT_ROOT"
docker compose config -q
echo "compose.yaml: OK"

log "[9/12] Pull core images"
docker compose pull homeassistant portainer wireguard caddy

log "[10/12] Start private core services"
docker compose up -d wireguard
for i in $(seq 1 20); do
  ip link show wg0 >/dev/null 2>&1 && break
  sleep 1
done
docker compose up -d homeassistant portainer

log "[11/12] Wait for Home Assistant"
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

log "[12/12] Validation"
"$PROJECT_ROOT/scripts/validate.sh" || true

CUDY_CONFIG="$DATA_DIR/wireguard/config/peer_cudy/peer_cudy.conf"
printf '\n============================================================\nSETUP COMPLETE\n============================================================\n'
echo "Core private services started: Home Assistant, WireGuard, Portainer"
echo "Home Assistant via VPN: http://${WG_SERVER_IP}:8123"
echo "SSH via VPN:            ssh <usuario>@${WG_SERVER_IP}"
echo "Portainer via VPN:      https://${WG_SERVER_IP}:9443"
echo "WireGuard public port:  UDP/${WG_SERVER_PORT:-51820}"
echo "Persistent data:        $DATA_DIR"
echo
echo "Configure PUBLIC_HOSTNAME, ACME_EMAIL and ALEXA_SKILL_ID in .env."
echo "Store the dedicated Home Assistant token only in: $HA_TOKEN_FILE"
echo "Then run: docker compose up -d --build cudy-alexa caddy"
echo
echo "SSH, Home Assistant and Portainer are blocked outside WireGuard by the host firewall."

if [[ -f "$CUDY_CONFIG" ]]; then
  echo
  echo "Cudy peer config: $CUDY_CONFIG"
  echo "This file contains a private key. Do not commit or share it."
else
  echo
  echo "Cudy peer config is not present yet. Check: docker logs wireguard"
fi
