from __future__ import annotations
from datetime import timedelta
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from .client import CudyError
from .const import DOMAIN

class CudyCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, client, interval=30):
        super().__init__(hass, logger=__import__('logging').getLogger(__name__), name=DOMAIN, update_interval=timedelta(seconds=interval))
        self.client=client
    async def _async_update_data(self):
        try: return await self.client.async_snapshot()
        except CudyError as exc: raise UpdateFailed(str(exc)) from exc
