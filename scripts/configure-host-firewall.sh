#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/etc/home-automation/firewall.env"
if [[ -r "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_SERVER_PORT="${WG_SERVER_PORT:-51820}"
SSH_PUBLIC_CIDR="${SSH_PUBLIC_CIDR:-}"

[[ "$WG_SERVER_PORT" =~ ^[0-9]{1,5}$ ]] || { echo "Invalid WG_SERVER_PORT" >&2; exit 1; }
(( WG_SERVER_PORT >= 1 && WG_SERVER_PORT <= 65535 )) || { echo "Invalid WG_SERVER_PORT" >&2; exit 1; }
[[ "$WG_INTERFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "Invalid WG_INTERFACE" >&2; exit 1; }

RULESET="$(mktemp)"
trap 'rm -f "$RULESET"' EXIT

cat >"$RULESET" <<EOF
table inet home_automation {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "lo" accept
    ct state established,related accept
    udp dport $WG_SERVER_PORT accept
    tcp dport { 80, 443 } accept
    iifname "$WG_INTERFACE" tcp dport { 22, 8123, 9443 } accept
EOF

if [[ -n "$SSH_PUBLIC_CIDR" ]]; then
  if [[ "$SSH_PUBLIC_CIDR" == *:* ]]; then
    printf '    ip6 saddr %s tcp dport 22 accept\n' "$SSH_PUBLIC_CIDR" >>"$RULESET"
  else
    printf '    ip saddr %s tcp dport 22 accept\n' "$SSH_PUBLIC_CIDR" >>"$RULESET"
  fi
fi

cat >>"$RULESET" <<'EOF'
    tcp dport { 22, 8000, 9000, 8123, 9443 } drop
  }
}
EOF

# Validate the replacement before changing active state. This native nftables
# table avoids iptables-nft compatibility failures on newer Oracle kernels and
# coexists with Docker/OCI-managed tables.
nft --check --file "$RULESET"
nft list table inet home_automation >/dev/null 2>&1 && nft delete table inet home_automation
nft --file "$RULESET"
nft list table inet home_automation >/dev/null
