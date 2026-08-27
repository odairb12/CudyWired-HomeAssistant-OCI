from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, SUPPORTED_HARDWARE


class CudyEntity(CoordinatorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, entry_id: str):
        super().__init__(coordinator)
        self._entry_id = entry_id

    @property
    def device_info(self) -> DeviceInfo:
        firmware = getattr(self.coordinator.data, "firmware", None)
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name="Cudy",
            manufacturer="Cudy",
            model="WR3000",
            hw_version=SUPPORTED_HARDWARE,
            sw_version=firmware,
        )
