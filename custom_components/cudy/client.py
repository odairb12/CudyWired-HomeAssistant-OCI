from __future__ import annotations
import asyncio
import hashlib
import html as html_lib
import logging
import random
import re
import time
from urllib.parse import urlencode
import aiohttp
from .const import SUPPORTED_FIRMWARE
from .models import CudyClientDevice, CudySnapshot

_LOGGER = logging.getLogger(__name__)

class CudyError(Exception): pass
class CudyCannotConnect(CudyError): pass
class CudyAuthError(CudyError): pass
class CudySessionExpired(CudyError): pass
class CudyParseError(CudyError): pass
class CudyApplyError(CudyError): pass
class CudyUnsupportedFirmware(CudyError): pass

SENSITIVE = re.compile(r"(sysauth|token|_csrf|salt|authorization|password|key)", re.I)

def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _input(doc: str, name: str) -> str | None:
    tag = re.search(r'<input[^>]*name=["\']' + re.escape(name) + r'["\'][^>]*>', doc, re.I)
    if not tag: return None
    value = re.search(r'value=["\']([^"\']*)', tag.group(0), re.I)
    return html_lib.unescape(value.group(1)) if value else ""

def _inputs(doc: str) -> dict[str, str]:
    out = {}
    for tag in re.findall(r'<input\b[^>]*>', doc, re.I):
        n = re.search(r'name=["\']([^"\']+)', tag, re.I)
        if not n: continue
        v = re.search(r'value=["\']([^"\']*)', tag, re.I)
        out[html_lib.unescape(n.group(1))] = html_lib.unescape(v.group(1)) if v else ""
    return out

def _text(doc: str) -> str:
    doc = re.sub(r'<script[\s\S]*?</script>', ' ', doc, flags=re.I)
    doc = re.sub(r'<style[\s\S]*?</style>', ' ', doc, flags=re.I)
    return re.sub(r'\s+', ' ', html_lib.unescape(re.sub(r'<[^>]+>', ' ', doc))).strip()

def _match(text: str, patterns: list[str]):
    for pattern in patterns:
        m = re.search(pattern, text, re.I)
        if m: return m.group(1).strip()
    return None

def _bool_status(text: str):
    low = text.lower()
    if re.search(r'\b(disconnected|desconectado|offline|down|inactive|inativo)\b', low): return False
    if re.search(r'\b(connected|conectado|online|up|active|ativo)\b', low): return True
    return None

class CudyClient:
    def __init__(self, host: str, username: str, password: str, verify_ssl: bool = True):
        self.base = host.rstrip('/')
        self.username = username
        self.password = password
        self.verify_ssl = verify_ssl
        self.session: aiohttp.ClientSession | None = None
        self._auth_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._last_login_attempt = 0.0
        self.firmware: str | None = None

    async def async_open(self):
        if self.session and not self.session.closed: return
        timeout = aiohttp.ClientTimeout(total=10, connect=5)
        jar = aiohttp.CookieJar(unsafe=True)
        connector = aiohttp.TCPConnector(ssl=self.verify_ssl)
        self.session = aiohttp.ClientSession(timeout=timeout, cookie_jar=jar, connector=connector, headers={"User-Agent":"HomeAssistant-Cudy/0.1"})

    async def async_close(self):
        if self.session and not self.session.closed: await self.session.close()

    async def _request(self, method: str, path: str, *, data=None, retry_get=True):
        await self.async_open()
        assert self.session
        try:
            async with self.session.request(method, self.base + path, data=data, allow_redirects=False) as r:
                body = await r.text(errors='replace')
                if r.status in (301,302,401,403) or 'name="luci_password' in body or "name='luci_password" in body:
                    raise CudySessionExpired()
                if r.status >= 400: raise CudyCannotConnect(f"HTTP {r.status} on {path}")
                return body
        except CudySessionExpired: raise
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            if method == 'GET' and retry_get:
                await asyncio.sleep(random.uniform(.15,.6))
                return await self._request(method, path, data=data, retry_get=False)
            raise CudyCannotConnect(str(exc)) from exc

    async def async_login(self, force=False):
        async with self._auth_lock:
            await self.async_open(); assert self.session
            if force: self.session.cookie_jar.clear()
            now = time.monotonic()
            if not force and now - self._last_login_attempt < 60 and self.session.cookie_jar: return
            self._last_login_attempt = now
            try:
                async with self.session.get(self.base + '/cgi-bin/luci/', allow_redirects=False) as r:
                    doc = await r.text(errors='replace')
                csrf, token, salt = _input(doc,'_csrf'), _input(doc,'token'), _input(doc,'salt')
                if not all((csrf,token,salt)): raise CudyAuthError('Login challenge missing')
                form = {'_csrf':csrf,'token':token,'salt':salt,'zonename':'America/Sao_Paulo','timeclock':str(int(time.time())),'luci_username':self.username,'luci_password':_sha(_sha(self.password + salt) + token),'luci_language':'pt_BR'}
                async with self.session.post(self.base + '/cgi-bin/luci/', data=form, allow_redirects=False) as r:
                    body = await r.text(errors='replace')
                if r.status >= 400 or not self.session.cookie_jar or re.search(r'luci_password|senha incorreta|invalid password',body,re.I):
                    self.session.cookie_jar.clear(); raise CudyAuthError('Authentication failed')
            except aiohttp.ClientError as exc: raise CudyCannotConnect(str(exc)) from exc

    async def async_get(self, path: str):
        await self.async_open(); assert self.session
        if not self.session.cookie_jar: await self.async_login()
        try: return await self._request('GET', path)
        except CudySessionExpired:
            await self.async_login(force=True)
            return await self._request('GET', path)

    async def async_logout(self):
        try: await self.async_get('/cgi-bin/luci/admin/logout')
        finally:
            if self.session: self.session.cookie_jar.clear()

    async def async_snapshot(self) -> CudySnapshot:
        paths = {
          'system':'/cgi-bin/luci/admin/system/status','lan':'/cgi-bin/luci/admin/network/lan/status','devices':'/cgi-bin/luci/admin/network/devices/status','devlist':'/cgi-bin/luci/admin/network/devices/devlist','wifi':'/cgi-bin/luci/admin/network/wireless/status','wisp':'/cgi-bin/luci/admin/network/wireless/wds/status','vpn':'/cgi-bin/luci/admin/network/vpn/status','guest':'/cgi-bin/luci/admin/network/wireless/guest'}
        raw = {}
        # Firmware has shown session instability under concurrent LuCI requests: serialize reads.
        for key,path in paths.items(): raw[key] = await self.async_get(path)
        txt = {k:_text(v) for k,v in raw.items()}
        firmware = _match(txt['system'], [r'(?:Firmware|Versão do Firmware)\s*[:\-]?\s*([\w.\-]+(?:\s+US)?)'])
        self.firmware = firmware or self.firmware
        clients = self._parse_clients(raw['devlist'])
        guest = _inputs(raw['guest'])
        def guest_state(iface):
            value = guest.get(f'cbid.wireless.{iface}.disabled')
            return None if value is None else value != '1'
        signal = _match(txt['wisp'], [r'(?:Signal|Sinal)\s*[:\-]?\s*(-?\d+)'])
        count = _match(txt['devices'], [r'(?:Clients|Clientes|Devices|Dispositivos)[^0-9]{0,30}(\d+)'])
        return CudySnapshot(
          uptime=_match(txt['system'],[r'(?:Uptime|Tempo de atividade)\s*[:\-]?\s*([^|]+?)(?=\s{2,}|Firmware|$)']), firmware=firmware,
          lan_ip=_match(txt['lan'],[r'(?:IPv4|IP Address|Endereço IP)\s*[:\-]?\s*(\d+\.\d+\.\d+\.\d+)']),
          wifi_channel=_match(txt['wifi'],[r'(?:Channel|Canal)\s*[:\-]?\s*(\d+)']), connected_clients=int(count) if count else len(clients),
          wisp_connected=_bool_status(txt['wisp']), wisp_signal=int(signal) if signal else None,
          vpn_connected=_bool_status(txt['vpn']), vpn_protocol=_match(txt['vpn'],[r'(WireGuard|OpenVPN|PPTP|L2TP)']),
          guest_24=guest_state('wlan02'), guest_5=guest_state('wlan12'), clients=clients, raw={k:_text(v) for k,v in raw.items()})

    def _parse_clients(self, doc: str):
        text = _text(doc)
        macs = re.findall(r'(?i)\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b', text)
        ips = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
        devices=[]
        for i,mac in enumerate(dict.fromkeys(macs)):
            ip = ips[i] if i < len(ips) else None
            devices.append(CudyClientDevice(key=mac.lower(), mac=mac.lower(), ip=ip, hostname=ip or f'device-{i+1}'))
        return devices

    async def async_set_guest(self, band: str, enabled: bool):
        if self.firmware and SUPPORTED_FIRMWARE not in self.firmware:
            raise CudyUnsupportedFirmware(f'Writes blocked on firmware {self.firmware}')
        iface = {'2.4':'wlan02','2.4ghz':'wlan02','24':'wlan02','5':'wlan12','5ghz':'wlan12'}.get(band.lower())
        if not iface: raise CudyApplyError('Unsupported guest band')
        async with self._write_lock:
            doc = await self.async_get('/cgi-bin/luci/admin/network/wireless/guest')
            fields = _inputs(doc)
            current = fields.get(f'cbid.wireless.{iface}.disabled')
            desired = '0' if enabled else '1'
            if current == desired: return
            # Never enable a confirmed open guest network automatically.
            encryption = fields.get(f'cbid.wireless.{iface}.encryption','')
            if enabled and encryption.lower() in ('','none','open'): raise CudyApplyError('Refusing to enable an open guest network')
            payload = {k:v for k,v in fields.items() if not SENSITIVE.search(k) or k in ('token','_csrf')}
            # Preserve key/password fields for the router even though they are never logged.
            for k,v in fields.items():
                if re.search(r'(\.key$|password)', k, re.I): payload[k]=v
            payload['timeclock']=str(int(time.time())); payload['cbi.submit']='1'; payload[f'cbi.cbe.wireless.{iface}.disabled']='1'; payload[f'cbid.wireless.{iface}.disabled']=desired
            try:
                await self._request('POST','/cgi-bin/luci/admin/network/wireless/guest',data=urlencode(payload),retry_get=False)
            except CudySessionExpired:
                # Never blindly retry a write. Re-read state first.
                await self.async_login(force=True)
                check=_inputs(await self.async_get('/cgi-bin/luci/admin/network/wireless/guest'))
                if check.get(f'cbid.wireless.{iface}.disabled') == desired: return
                raise CudyApplyError('Session expired during write; state unchanged or ambiguous')
            await self._request('GET','/cgi-bin/luci/admin/servicectl/restart/guest,firewall',retry_get=False)
            for _ in range(30):
                status=_text(await self.async_get('/cgi-bin/luci/admin/servicectl/status')).lower()
                if 'finish' in status: break
                await asyncio.sleep(1)
            else: raise CudyApplyError('Guest/firewall apply timed out')
            verify=_inputs(await self.async_get('/cgi-bin/luci/admin/network/wireless/guest'))
            if verify.get(f'cbid.wireless.{iface}.disabled') != desired: raise CudyApplyError('Guest state verification failed')
