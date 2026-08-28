from __future__ import annotations

from homeassistant.components.button import ButtonEntity

from .client import CudyApplyError, CudyCannotConnect, CudySessionExpired, _reboot_apply_path
from .const import DOMAIN
from .entity import CudyEntity


async def async_setup_entry(hass, entry, async_add_entities):
    data = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [CudyRebootButton(data["coordinator"], data["client"], entry.entry_id)]
    )


class CudyRebootButton(CudyEntity, ButtonEntity):
    _attr_name = "Reboot router"
    _attr_icon = "mdi:restart"

    def __init__(self, coordinator, client, entry_id):
        super().__init__(coordinator, entry_id)
        self.client = client
        self._attr_unique_id = f"{entry_id}_reboot"

    async def async_press(self) -> None:
        self.client._assert_write_supported()
        doc = await self.client.async_get("/cgi-bin/luci/admin/system/reboot")
        apply_path = _reboot_apply_path(doc)
        if not apply_path:
            raise CudyApplyError("Reboot apply endpoint missing")
        try:
            await self.client._request(
                "GET",
                apply_path,
                retry_get=False,
            )
        except (CudyCannotConnect, CudySessionExpired):
            # The router commonly closes or redirects the connection after
            # accepting reboot. Never retry this state-changing GET.
            return
