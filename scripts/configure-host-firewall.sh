#!/usr/bin/env bash
set -Eeuo pipefail

ensure_tcp() {
  local port="$1"
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
}

ensure_udp() {
  local port="$1"
  iptables -C INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p udp --dport "$port" -j ACCEPT
}

# The Linux host is prepared to receive these services. Internet exposure is
# controlled separately by OCI Security Lists/NSGs.
ensure_tcp 22
ensure_tcp 8123
ensure_tcp 9443
ensure_udp 51820
