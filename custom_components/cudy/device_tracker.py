from homeassistant.components.device_tracker import TrackerEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]['coordinator']
    known = set()

    def discover():
        new = []
        for device in coordinator.data.clients:
            if device.key not in known:
                known.add(device.key)
                new.append(CudyTracker(coordinator, entry.entry_id, device.key))
        if new:
            async_add_entities(new)

    discover()
    entry.async_on_unload(coordinator.async_add_listener(discover))

class CudyTracker(CoordinatorEntity, TrackerEntity):
    def __init__(self, coordinator, entry_id, key):
        super().__init__(coordinator)
        self.key = key
        self._attr_unique_id = f'{entry_id}_client_{key.replace(":", "")}'

    @property
    def _device(self):
        return next((d for d in self.coordinator.data.clients if d.key == self.key), None)

    @property
    def is_connected(self):
        return bool(self._device and self._device.connected)

    @property
    def name(self):
        return self._device.hostname if self._device else self.key

    @property
    def ip_address(self):
        return self._device.ip if self._device else None

    @property
    def mac_address(self):
        return self._device.mac if self._device else None
