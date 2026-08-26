# Cudy WR3000 Home Assistant Integration

Implementation baseline: WR3000 V1.0 / firmware `2.4.19-20250828-192837`.

This implementation follows the investigated scope supplied for the project: local polling through WireGuard, reusable LuCI session, confirmed read endpoints, Guest 2.4/5 switches, device tracking, diagnostics redaction, and conservative write semantics. The router panel remains private.

## Implemented

- LuCI double SHA-256 challenge login with aiohttp CookieJar and session reuse.
- Serialized router polling and one controlled reauthentication after an expired session.
- System, LAN, device summary/list, Wi-Fi, WISP, VPN and Guest reads.
- Sensors: uptime, firmware, LAN IP, connected clients, WISP signal, VPN protocol, Wi-Fi channel.
- Binary sensors: WISP and VPN.
- Device trackers based on discovered client MACs.
- Guest Wi-Fi 2.4 GHz (`wlan02`) and 5 GHz (`wlan12`) switches.
- Guest write: GET → preserve form → change disabled only → apply guest/firewall → wait → GET verify.
- No blind POST retry.
- Refusal to automatically enable a guest network detected as open.
- Writes blocked when a different firmware is positively identified.
- Redacted diagnostics.
- Config flow limited to private IP targets.
- Alexa interaction model and required `ALEXA_SKILL_ID` configuration added.

## Intentionally not implemented as controls

Reboot, factory reset, firmware upgrade, LAN/WAN/WISP/VPN mutation, firewall mutation, log clearing and broad service restart remain excluded. They were explicitly outside the integration's safe/default scope and/or were not validated on hardware. Discovery of an endpoint is not sufficient evidence for a destructive implementation.

## Still requires hardware validation

Guest POST and `/servicectl/restart/guest,firewall` were discovered but not executed during the investigation. The code therefore uses conservative read-before-write, no blind retry, final verification, firmware gating, and refuses to enable an open guest SSID. Validate under supervision before exposing Guest switches to Alexa.

Bandwidth remains unsupported because the simple discovered request returned HTTP 500 and required parameters are unknown. WAN online state is not inferred from panel reachability because no authoritative read endpoint was confirmed.
