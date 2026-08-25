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

printf '\n== WireGuard NAT ==\n'
docker exec wireguard iptables -t nat -L PREROUTING -n -v || true

printf '\n== Host firewall ==\n'
iptables -L INPUT -n -v --line-numbers
