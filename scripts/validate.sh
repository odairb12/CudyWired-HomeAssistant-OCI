#!/usr/bin/env bash
set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HOME_LAN_CIDR="${HOME_LAN_CIDR:-192.168.50.0/24}"
WG_ALLOWED_IPS_VALUE="${WG_ALLOWED_IPS:-10.99.0.1/32}"
WG_SERVER_IP="${WG_SERVER_IP:-${WG_ALLOWED_IPS_VALUE%%/*}}"
WG_PEER_IP="${WG_PEER_IP:-10.99.0.2}"
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

if ip link show wg0 >/dev/null 2>&1 && ip -4 addr show wg0 2>/dev/null | grep -Fq "$WG_SERVER_IP"; then
  ok "WireGuard server IP presente"
else
  fail "WireGuard wg0/server IP indisponivel"
fi

if docker exec wireguard wg show 2>/dev/null | grep -q 'latest handshake:'; then
  ok "Cudy conectado"
else
  fail "Cudy sem handshake"
fi

if ip route show "$HOME_LAN_CIDR" 2>/dev/null | grep -q 'dev wg0'; then
  ok "Rota residencial via WireGuard"
else
  fail "Rota residencial nao aponta para wg0"
fi

if ping -c 1 -W 2 "$WG_PEER_IP" >/dev/null 2>&1; then
  ok "Cudy acessivel pela VPN"
else
  fail "Peer Cudy nao responde pela VPN"
fi

if nft list chain inet home_automation input 2>/dev/null | grep -Eq 'tcp dport \{[^}]*22[^}]*8000[^}]*8123[^}]*9000[^}]*9443[^}]*\} drop'; then
  ok "Firewall bloqueia portas administrativas fora da VPN"
else
  fail "Regra de bloqueio administrativo nao encontrada"
fi

if nft list chain inet home_automation input 2>/dev/null | grep -Eq 'iifname "wg0" tcp dport \{[^}]*22[^}]*8123[^}]*9443[^}]*\} accept'; then
  ok "Firewall permite administracao por wg0"
else
  fail "Regra administrativa de wg0 nao encontrada"
fi

if ss -lnt 2>/dev/null | grep -qE '(^|[[:space:]])[^[:space:]]*:9443[[:space:]]'; then
  ok "Portainer HTTPS escutando"
else
  fail "Portainer 9443 nao esta escutando"
fi

if ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE '^(\*|0\.0\.0\.0|\[::\]):(8000|9000)$'; then
  warn "Portainer possui listener publico 8000/9000; firewall deve mante-lo bloqueado"
else
  ok "Portainer sem listeners publicos 8000/9000"
fi

if [[ -f /etc/ssh/sshd_config.d/99-home-automation-hardening.conf ]]; then
  if sshd -T 2>/dev/null | grep -q '^passwordauthentication no$' && \
     sshd -T 2>/dev/null | grep -q '^permitrootlogin no$'; then
    ok "SSH hardening ativo"
  else
    fail "SSH hardening incompleto"
  fi
else
  warn "SSH hardening nao instalado (verifique authorized_keys)"
fi

if [[ -s "${DATA_DIR:-/srv/home-automation}/secrets/ha_token" ]]; then
  ok "Token HA armazenado em arquivo privado"
else
  warn "Token HA dedicado ainda nao configurado"
fi

if swapon --show --noheadings 2>/dev/null | grep -q .; then
  ok "Swap ativa"
else
  warn "Swap nao esta ativa"
fi

if [[ "$VERBOSE" -eq 1 ]]; then
  printf '\n--- Diagnostico ---\n'
  docker compose ps || true
  printf '\nFirewall home automation:\n'
  nft list table inet home_automation || true
  printf '\nWireGuard:\n'
  docker exec wireguard wg show || true
  printf '\nInterface wg0:\n'
  ip addr show wg0 || true
  printf '\nRota residencial:\n'
  ip route show "$HOME_LAN_CIDR" || true
  printf '\nListeners administrativos:\n'
  ss -lntp | grep -E ':(22|8000|9000|8123|9443)\b' || true
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
