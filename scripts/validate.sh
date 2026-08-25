#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HOME_LAN_CIDR="${HOME_LAN_CIDR:-192.168.10.0/24}"

printf '\n== Compose ==\n'
docker compose config -q && echo "compose.yaml: OK"

printf '\n== Containers ==\n'
docker compose ps

printf '\n== Memory ==\n'
free -h

printf '\n== Disk ==\n'
df -h /

printf '\n== Home Assistant ==\n'
if curl -fsS --connect-timeout 3 http://127.0.0.1:8123 >/dev/null; then
  echo "Home Assistant: OK"
else
  echo "Home Assistant: not ready"
fi

printf '\n== WireGuard ==\n'
docker exec wireguard wg show || true

printf '\n== Host WireGuard interface ==\n'
if ip link show wg0 >/dev/null 2>&1; then
  ip addr show wg0
else
  echo "wg0: not present on host"
fi

printf '\n== Home LAN route ==\n'
if ip route show "$HOME_LAN_CIDR" | grep -q 'dev wg0'; then
  ip route show "$HOME_LAN_CIDR"
  echo "Home LAN route: OK"
else
  echo "Home LAN route does not point to wg0"
  ip route show "$HOME_LAN_CIDR" || true
fi

printf '\n== Host firewall ==\n'
iptables -L INPUT -n -v --line-numbers
