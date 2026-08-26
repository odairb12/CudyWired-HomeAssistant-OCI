from homeassistant.components.binary_sensor import BinarySensorEntity

from .const import DOMAIN
from .entity import CudyEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities(
        [
            CudyBinarySensor(coordinator, entry.entry_id, "wisp_connected", "WISP"),
            CudyBinarySensor(coordinator, entry.entry_id, "vpn_connected", "VPN"),
        ]
    )


class CudyBinarySensor(CudyEntity, BinarySensorEntity):
    def __init__(self, coordinator, entry_id, attr, name):
        super().__init__(coordinator, entry_id)
        self._state_attr = attr
        self._attr_name = name
        self._attr_unique_id = f"{entry_id}_{attr}"

    @property
    def is_on(self):
        return getattr(self.coordinator.data, self._state_attr, None)
