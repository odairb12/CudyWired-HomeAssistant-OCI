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
- Reboot button in Home Assistant using `/cgi-bin/luci/admin/system/reboot`, with authenticated form preservation and no retry after POST.
- Alexa commands for Guest Wi-Fi ON/OFF and router reboot, with explicit confirmation before execution.
- Alexa `RouterRebootIntent`, `GuestWifiControlIntent`, confirmation and cancellation intents versioned in `services/cudy-alexa/alexa/pt-BR.json`.
- No blind POST retry for Guest or reboot.
- Refusal to automatically enable a guest network detected as open.
- Writes blocked when a different firmware is positively identified.
- Redacted diagnostics.
- Config flow limited to private IP targets.
- Required `ALEXA_SKILL_ID` configuration documented in `.env.example`.

## Supported voice controls

The Custom Skill supports the following control intents after the user invokes the skill:

- ligar rede de convidados;
- desligar rede de convidados;
- ligar/desligar convidados em 2.4 GHz;
- ligar/desligar convidados em 5 GHz;
- reiniciar o roteador.

Guest and reboot require a second confirmation utterance before execution. The backend serializes writes and refuses concurrent router changes.

## Intentionally not implemented as controls

Factory reset, firmware upgrade, LAN/WAN/WISP/VPN mutation, firewall mutation, log clearing and broad service restart remain excluded. Those operations were not validated on hardware and have a significantly larger blast radius. Discovery of an endpoint is not sufficient evidence for a destructive implementation.

## Hardware-validation status

Guest POST and `/servicectl/restart/guest,firewall` were discovered during investigation but were not executed in the original mapping session. The implementation therefore uses read-before-write, preserves the form, never blindly retries POST, waits for `servicectl/status`, and verifies final state.

Reboot uses the authenticated reboot form and treats an immediate connection drop as an expected success condition because the router can terminate HTTP as it restarts. It never retries a reboot POST.

These controls are implemented but still require supervised validation on the physical WR3000 before being considered production-validated.

Bandwidth remains unsupported because the simple discovered request returned HTTP 500 and required parameters are unknown. WAN online state is not inferred from panel reachability because no authoritative read endpoint was confirmed.
