#!/usr/bin/env bash
set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HOME_LAN_CIDR="${HOME_LAN_CIDR:-192.168.10.0/24}"
WG_SERVER_IP="${WG_SERVER_IP:-10.13.13.1}"
WG_PEER_IP="${WG_PEER_IP:-10.13.13.2}"
VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

PASS=0
FAIL=0
WARN=0

ok()   { printf 'OK    %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'ERRO  %s\n' "$1"; FAIL=$((FAIL + 1)); }
warn() { printf 'AVISO %s\n' "$1"; WARN=$((WARN + 1)); }

check_container() {
  local name="$1"
  if [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" == "true" ]]; then
    ok "$name em execucao"
  else
    fail "$name nao esta em execucao"
  fi
}

printf '\nValidando Home Automation...\n\n'

if docker compose config -q >/dev/null 2>&1; then
  ok "Docker Compose"
else
  fail "Docker Compose invalido"
fi

check_container homeassistant
check_container portainer
check_container wireguard

if curl -fsS --connect-timeout 3 http://127.0.0.1:8123 >/dev/null 2>&1; then
  ok "Home Assistant"
else
  fail "Home Assistant nao responde"
fi

if ip link show wg0 >/dev/null 2>&1 && ip -4 addr show wg0 2>/dev/null | grep -q "$WG_SERVER_IP"; then
  ok "WireGuard $WG_SERVER_IP"
else
  fail "WireGuard wg0/$WG_SERVER_IP indisponivel"
fi

if docker exec wireguard wg show 2>/dev/null | grep -q 'latest handshake:'; then
  ok "Cudy conectado"
else
  fail "Cudy sem handshake"
fi

if ip route show "$HOME_LAN_CIDR" 2>/dev/null | grep -q 'dev wg0'; then
  ok "Rota residencial via WireGuard"
else
  fail "Rota $HOME_LAN_CIDR nao aponta para wg0"
fi

if ping -c 1 -W 2 "$WG_PEER_IP" >/dev/null 2>&1; then
  ok "Cudy acessivel pela VPN"
else
  fail "Cudy $WG_PEER_IP nao responde pela VPN"
fi

if swapon --show --noheadings 2>/dev/null | grep -q .; then
  ok "Swap ativa"
else
  warn "Swap nao esta ativa"
fi

if [[ "$VERBOSE" -eq 1 ]]; then
  printf '\n--- Diagnostico ---\n'
  docker compose ps || true
  printf '\nWireGuard:\n'
  docker exec wireguard wg show || true
  printf '\nInterface wg0:\n'
  ip addr show wg0 || true
  printf '\nRota residencial:\n'
  ip route show "$HOME_LAN_CIDR" || true
  printf '\nMemoria:\n'
  free -h || true
  printf '\nDisco:\n'
  df -h / || true
fi

printf '\n----------------------------------------\n'
printf 'Resultado: %d OK | %d aviso(s) | %d erro(s)\n' "$PASS" "$WARN" "$FAIL"

if [[ "$FAIL" -eq 0 ]]; then
  printf 'STATUS: OK\n\n'
  exit 0
fi

printf 'STATUS: ERRO\n\n'
printf 'Use --verbose para diagnostico detalhado.\n\n'
exit 1
