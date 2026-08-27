#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/etc/home-automation/firewall.env"
[[ -r "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_SERVER_PORT="${WG_SERVER_PORT:-51820}"
SSH_PUBLIC_CIDR="${SSH_PUBLIC_CIDR:-}"

[[ "$WG_SERVER_PORT" =~ ^[0-9]{1,5}$ ]] || { echo "Invalid WG_SERVER_PORT" >&2; exit 1; }
(( WG_SERVER_PORT >= 1 && WG_SERVER_PORT <= 65535 )) || { echo "Invalid WG_SERVER_PORT" >&2; exit 1; }

configure_v4() {
  local chain="HOME_AUTOMATION_INPUT"
  iptables -N "$chain" 2>/dev/null || true
  iptables -F "$chain"

  iptables -A "$chain" -i lo -j ACCEPT
  iptables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A "$chain" -p udp --dport "$WG_SERVER_PORT" -j ACCEPT
  iptables -A "$chain" -p tcp -m multiport --dports 80,443 -j ACCEPT
  iptables -A "$chain" -i "$WG_INTERFACE" -p tcp -m multiport --dports 22,8123,9443 -j ACCEPT

  if [[ -n "$SSH_PUBLIC_CIDR" && "$SSH_PUBLIC_CIDR" != *:* ]]; then
    iptables -A "$chain" -p tcp -s "$SSH_PUBLIC_CIDR" --dport 22 -j ACCEPT
  fi

  # Defense in depth: administrative services remain private even if an OCI
  # NSG/Security List is accidentally opened to the Internet. Portainer's
  # legacy HTTP/Edge ports are blocked because this deployment does not use them.
  iptables -A "$chain" -p tcp -m multiport --dports 22,8000,9000,8123,9443 -j DROP
  iptables -A "$chain" -j RETURN

  iptables -C INPUT -j "$chain" 2>/dev/null || iptables -I INPUT 1 -j "$chain"

  # Keep a Docker guard as defense in depth for any future published 9443 port.
  if iptables -nL DOCKER-USER >/dev/null 2>&1; then
    local docker_chain="HOME_AUTOMATION_DOCKER"
    iptables -N "$docker_chain" 2>/dev/null || true
    iptables -F "$docker_chain"
    iptables -A "$docker_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A "$docker_chain" -i "$WG_INTERFACE" -p tcp --dport 9443 -j ACCEPT
    iptables -A "$docker_chain" -p tcp --dport 9443 -j DROP
    iptables -A "$docker_chain" -j RETURN
    iptables -C DOCKER-USER -j "$docker_chain" 2>/dev/null || iptables -I DOCKER-USER 1 -j "$docker_chain"
  fi
}

configure_v6() {
  command -v ip6tables >/dev/null 2>&1 || return 0

  local chain="HOME_AUTOMATION_INPUT"
  ip6tables -N "$chain" 2>/dev/null || true
  ip6tables -F "$chain"
  ip6tables -A "$chain" -i lo -j ACCEPT
  ip6tables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -A "$chain" -p udp --dport "$WG_SERVER_PORT" -j ACCEPT
  ip6tables -A "$chain" -p tcp -m multiport --dports 80,443 -j ACCEPT
  ip6tables -A "$chain" -i "$WG_INTERFACE" -p tcp -m multiport --dports 22,8123,9443 -j ACCEPT

  if [[ -n "$SSH_PUBLIC_CIDR" && "$SSH_PUBLIC_CIDR" == *:* ]]; then
    ip6tables -A "$chain" -p tcp -s "$SSH_PUBLIC_CIDR" --dport 22 -j ACCEPT
  fi

  ip6tables -A "$chain" -p tcp -m multiport --dports 22,8000,9000,8123,9443 -j DROP
  ip6tables -A "$chain" -j RETURN
  ip6tables -C INPUT -j "$chain" 2>/dev/null || ip6tables -I INPUT 1 -j "$chain"
}

configure_v4
configure_v6
