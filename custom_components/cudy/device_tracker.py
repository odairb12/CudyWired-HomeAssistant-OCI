from homeassistant.components.device_tracker import TrackerEntity

from .const import DOMAIN
from .entity import CudyEntity

MISSES_BEFORE_AWAY = 3


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
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


class CudyTracker(CudyEntity, TrackerEntity):
    def __init__(self, coordinator, entry_id, key):
        super().__init__(coordinator, entry_id)
        self.key = key
        self._attr_unique_id = f'{entry_id}_client_{key.replace(":", "")}'
        self._misses = 0
        self._ever_seen = True
        self._last_name = key
        self._last_ip = None
        self._last_mac = key
        self._capture_current()

    @property
    def _device(self):
        return next((d for d in self.coordinator.data.clients if d.key == self.key), None)

    def _capture_current(self):
        device = self._device
        if device:
            self._misses = 0
            self._ever_seen = True
            self._last_name = device.hostname or self._last_name
            self._last_ip = device.ip or self._last_ip
            self._last_mac = device.mac or self._last_mac
        else:
            self._misses += 1

    def _handle_coordinator_update(self) -> None:
        self._capture_current()
        super()._handle_coordinator_update()

    @property
    def is_connected(self):
        return self._ever_seen and self._misses < MISSES_BEFORE_AWAY

    @property
    def name(self):
        return self._last_name

    @property
    def ip_address(self):
        return self._last_ip

    @property
    def mac_address(self):
        return self._last_mac
