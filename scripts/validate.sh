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

PASS=0
FAIL=0
WARN=0

ok() {
  printf 'OK    %s\n' "$1"
  PASS=$((PASS + 1))
}

fail() {
  printf 'ERRO  %s\n' "$1"
  FAIL=$((FAIL + 1))
}

warn() {
  printf 'AVISO %s\n' "$1"
  WARN=$((WARN + 1))
}

check_container() {
  local name="$1"
  if [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" == "true" ]]; then
    ok "Container $name em execucao"
  else
    fail "Container $name nao esta em execucao"
  fi
}

printf '\nValidando Home Automation...\n\n'

if docker compose config -q >/dev/null 2>&1; then
  ok "Docker Compose valido"
else
  fail "Docker Compose invalido"
fi

check_container homeassistant
check_container portainer
check_container wireguard

if curl -fsS --connect-timeout 3 http://127.0.0.1:8123 >/dev/null 2>&1; then
  ok "Home Assistant respondendo na porta 8123"
else
  fail "Home Assistant nao responde na porta 8123"
fi

if ip link show wg0 >/dev/null 2>&1; then
  ok "Interface WireGuard wg0 ativa no host"
else
  fail "Interface WireGuard wg0 nao existe no host"
fi

if ip -4 addr show wg0 2>/dev/null | grep -q "$WG_SERVER_IP"; then
  ok "WireGuard usando $WG_SERVER_IP"
else
  fail "WireGuard nao possui o IP $WG_SERVER_IP"
fi

if docker exec wireguard wg show 2>/dev/null | grep -q 'latest handshake:'; then
  ok "WireGuard com handshake ativo"
else
  fail "WireGuard sem handshake com o Cudy"
fi

if ip route show "$HOME_LAN_CIDR" 2>/dev/null | grep -q 'dev wg0'; then
  ok "Rota $HOME_LAN_CIDR via wg0"
else
  fail "Rota $HOME_LAN_CIDR nao aponta para wg0"
fi

if swapon --show --noheadings 2>/dev/null | grep -q .; then
  ok "Swap ativa"
else
  warn "Swap nao esta ativa"
fi

MEM_AVAILABLE_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [[ -n "${MEM_AVAILABLE_KB:-}" && "$MEM_AVAILABLE_KB" -lt 102400 ]]; then
  warn "Menos de 100 MB de RAM disponivel"
fi

DISK_USE=$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
if [[ -n "${DISK_USE:-}" && "$DISK_USE" -ge 85 ]]; then
  warn "Disco raiz acima de 85% de uso"
fi

printf '\n----------------------------------------\n'
printf 'Resultado: %d OK | %d aviso(s) | %d erro(s)\n' "$PASS" "$WARN" "$FAIL"

if [[ "$FAIL" -eq 0 ]]; then
  printf 'STATUS: OK\n\n'
  exit 0
fi

printf 'STATUS: ERRO\n\n'
exit 1
