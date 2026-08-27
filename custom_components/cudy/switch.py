from homeassistant.components.switch import SwitchEntity

from .const import DOMAIN
from .entity import CudyEntity


async def async_setup_entry(hass, entry, async_add_entities):
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            GuestSwitch(data["coordinator"], data["client"], entry.entry_id, "2.4", "guest_24", "Guest Wi-Fi 2.4 GHz"),
            GuestSwitch(data["coordinator"], data["client"], entry.entry_id, "5", "guest_5", "Guest Wi-Fi 5 GHz"),
            GuestAllSwitch(data["coordinator"], data["client"], entry.entry_id),
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


class GuestAllSwitch(CudyEntity, SwitchEntity):
    """Composite Guest switch that applies both bands in one LuCI transaction."""

    _attr_name = "Guest Wi-Fi All"

    def __init__(self, coordinator, client, entry_id):
        super().__init__(coordinator, entry_id)
        self.client = client
        self._attr_unique_id = f"{entry_id}_guest_all"

    @property
    def is_on(self):
        guest_24 = getattr(self.coordinator.data, "guest_24", None)
        guest_5 = getattr(self.coordinator.data, "guest_5", None)
        if guest_24 is None or guest_5 is None:
            return None
        return guest_24 and guest_5

    async def async_turn_on(self, **kwargs):
        await self.client.async_set_guest_bands(["2.4", "5"], True)
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs):
        await self.client.async_set_guest_bands(["2.4", "5"], False)
        await self.coordinator.async_request_refresh()
