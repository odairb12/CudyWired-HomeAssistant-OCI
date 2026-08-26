from __future__ import annotations
import ipaddress
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from .client import CudyAuthError, CudyCannotConnect, CudyClient
from .const import CONF_VERIFY_SSL, DEFAULT_HOST, DEFAULT_USERNAME, DOMAIN

class CudyConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION=1
    async def async_step_user(self,user_input=None):
        errors={}
        if user_input:
            try:
                host=user_input[CONF_HOST].replace('http://','').replace('https://','').split('/')[0].split(':')[0]
                ip=ipaddress.ip_address(host)
                if not (ip.is_private or ip.is_loopback): raise ValueError('public')
                client=CudyClient(user_input[CONF_HOST],user_input[CONF_USERNAME],user_input[CONF_PASSWORD],user_input[CONF_VERIFY_SSL])
                await client.async_login(); snap=await client.async_snapshot(); await client.async_close()
                await self.async_set_unique_id(snap.lan_ip or user_input[CONF_HOST]); self._abort_if_unique_id_configured()
                return self.async_create_entry(title='Cudy WR3000',data={CONF_HOST:user_input[CONF_HOST],CONF_USERNAME:user_input[CONF_USERNAME],CONF_PASSWORD:user_input[CONF_PASSWORD]},options={CONF_VERIFY_SSL:user_input[CONF_VERIFY_SSL]})
            except CudyAuthError: errors['base']='invalid_auth'
            except (CudyCannotConnect,ValueError): errors['base']='cannot_connect'
        schema=vol.Schema({vol.Required(CONF_HOST,default=DEFAULT_HOST):str,vol.Required(CONF_USERNAME,default=DEFAULT_USERNAME):str,vol.Required(CONF_PASSWORD):str,vol.Required(CONF_VERIFY_SSL,default=False):bool})
        return self.async_show_form(step_id='user',data_schema=schema,errors=errors)
