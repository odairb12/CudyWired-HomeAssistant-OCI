from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

@dataclass(slots=True)
class CudyClientDevice:
    key: str
    hostname: str | None = None
    ip: str | None = None
    mac: str | None = None
    connected: bool = True
    signal: int | None = None
    rate: str | None = None
    interface: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

@dataclass(slots=True)
class CudySnapshot:
    uptime: str | None = None
    firmware: str | None = None
    lan_ip: str | None = None
    wifi_channel: str | None = None
    connected_clients: int = 0
    wisp_connected: bool | None = None
    wisp_signal: int | None = None
    vpn_connected: bool | None = None
    vpn_protocol: str | None = None
    lan_enabled: bool | None = None
    wifi_24_enabled: bool | None = None
    wifi_5_enabled: bool | None = None
    mesh_active: bool | None = None
    dhcp_enabled: bool | None = None
    guest_24: bool | None = None
    guest_5: bool | None = None
    clients: list[CudyClientDevice] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
