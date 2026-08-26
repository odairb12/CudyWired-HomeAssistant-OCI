from homeassistant.components.switch import SwitchEntity

from .const import DOMAIN
from .entity import CudyEntity


async def async_setup_entry(hass, entry, async_add_entities):
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            GuestSwitch(data["coordinator"], data["client"], entry.entry_id, "2.4", "guest_24", "Guest Wi-Fi 2.4 GHz"),
            GuestSwitch(data["coordinator"], data["client"], entry.entry_id, "5", "guest_5", "Guest Wi-Fi 5 GHz"),
        ]
    )


class GuestSwitch(CudyEntity, SwitchEntity):
    def __init__(self, coordinator, client, entry_id, band, state_attr, name):
        super().__init__(coordinator, entry_id)
        self.client = client
        self.band = band
        self._state_attr = state_attr
        self._attr_name = name
        suffix = band.replace(".", "_")
        self._attr_unique_id = f"{entry_id}_guest_{suffix}"

    @property
    def is_on(self):
        return getattr(self.coordinator.data, self._state_attr, None)

    async def async_turn_on(self, **kwargs):
        await self.client.async_set_guest(self.band, True)
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs):
        await self.client.async_set_guest(self.band, False)
        await self.coordinator.async_request_refresh()
