#!/bin/sh
set -eu

HOST_GW="$(ip route show default | awk 'NR==1 {print $3}')"

if [ -z "$HOST_GW" ]; then
  echo "wireguard-post-start: host gateway not found" >&2
  exit 1
fi

for PORT in 22 8123 9443; do
  iptables -t nat -C PREROUTING \
    -i wg0 -p tcp --dport "$PORT" \
    -j DNAT --to-destination "$HOST_GW:$PORT" 2>/dev/null || \
  iptables -t nat -A PREROUTING \
    -i wg0 -p tcp --dport "$PORT" \
    -j DNAT --to-destination "$HOST_GW:$PORT"

  iptables -t nat -C POSTROUTING \
    -o eth0 -p tcp -d "$HOST_GW" --dport "$PORT" \
    -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING \
    -o eth0 -p tcp -d "$HOST_GW" --dport "$PORT" \
    -j MASQUERADE
done

echo "wireguard-post-start: forwarding configured through host gateway $HOST_GW"
