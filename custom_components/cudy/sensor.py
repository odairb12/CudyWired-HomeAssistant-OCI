from dataclasses import dataclass

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription

from .const import DOMAIN
from .entity import CudyEntity


@dataclass(frozen=True, kw_only=True)
class CudySensorDescription(SensorEntityDescription):
    attr: str


DESCRIPTIONS = [
    CudySensorDescription(key="uptime", name="Uptime", attr="uptime"),
    CudySensorDescription(key="firmware", name="Firmware", attr="firmware"),
    CudySensorDescription(key="lan_ip", name="LAN IP", attr="lan_ip"),
    CudySensorDescription(key="connected_clients", name="Connected clients", attr="connected_clients"),
    CudySensorDescription(key="wisp_signal", name="WISP signal", attr="wisp_signal"),
    CudySensorDescription(key="vpn_protocol", name="VPN protocol", attr="vpn_protocol"),
    CudySensorDescription(key="wifi_channel", name="Wi-Fi channel", attr="wifi_channel"),
]


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities(
        [CudySensor(coordinator, description, entry.entry_id) for description in DESCRIPTIONS]
    )


class CudySensor(CudyEntity, SensorEntity):
    def __init__(self, coordinator, description, entry_id):
        super().__init__(coordinator, entry_id)
        self.entity_description = description
        self._attr_unique_id = f"{entry_id}_{description.key}"

    @property
    def native_value(self):
        return getattr(self.coordinator.data, self.entity_description.attr, None)
