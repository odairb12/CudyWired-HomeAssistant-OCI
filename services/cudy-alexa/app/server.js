const crypto = require('node:crypto');
const fs = require('node:fs');
const YAML = require('yaml');
const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');

const BASE = (process.env.CUDY_URL || 'http://192.168.10.1').replace(/\/$/, '');
const USER = process.env.CUDY_USERNAME || 'admin';
const PASSWORD = process.env.CUDY_PASSWORD;
const ALEXA_SKILL_ID = process.env.ALEXA_SKILL_ID || '';
const TIMEOUT_MS = 10000;
let cookie = '';
let loginPromise = null;
let writePromise = null;

function loadPolicy() {
  try { return YAML.parse(fs.readFileSync(process.env.POLICY_PATH || '/app/policy.yaml', 'utf8')) || {}; }
  catch (err) { console.error('policy load failed:', err.message); return {}; }
}
const POLICY = loadPolicy();
function permitted(group, key, fallback = false) {
  const value = POLICY?.[group]?.[key];
  return value === undefined ? fallback : value === true;
}
const READ_CAPABILITIES = {
  sistema: { path: '/cgi-bin/luci/admin/system/status', label: 'sistema', key: 'system' },
  lan: { path: '/cgi-bin/luci/admin/network/lan/status', label: 'LAN', key: 'lan' },
  dispositivos: { path: '/cgi-bin/luci/admin/network/devices/status', label: 'dispositivos conectados', key: 'devices' },
  wifi: { path: '/cgi-bin/luci/admin/network/wireless/status', label: 'Wi-Fi', key: 'wifi' },
  convidados: { path: '/cgi-bin/luci/admin/network/wireless/guest', label: 'Wi-Fi de convidados', key: 'guest_wifi' },
  wisp: { path: '/cgi-bin/luci/admin/network/wireless/wds/status', label: 'WISP', key: 'wisp' },
  vpn: { path: '/cgi-bin/luci/admin/network/vpn/status', label: 'VPN', key: 'vpn' },
  dhcp: { path: '/cgi-bin/luci/admin/services/dhcp/status', label: 'DHCP', key: 'dhcp' },
  mesh: { path: '/cgi-bin/luci/admin/network/mesh/status', label: 'mesh', key: 'mesh' },
  rotas: { path: '/cgi-bin/luci/admin/system/status/ip4routes', label: 'rotas', key: 'routes' },
  interfaces: { path: '/cgi-bin/luci/admin/system/status/ifstat', label: 'interfaces', key: 'interfaces' },
  arp: { path: '/cgi-bin/luci/admin/system/status/arp', label: 'dispositivos ARP', key: 'arp' }
};

function digest(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function clean(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); }
function input(html, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp('<input[^>]*name=[\"\']' + safe + '[\"\'][^>]*>', 'i'));
  if (!match) return '';
  const value = match[0].match(/value=[\"\']([^\"\']*)/i);
  return value ? value[1] : '';
}
function inputs(html) {
  const result = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    const name = tag.match(/name=["']([^"']+)/i);
    if (!name) continue;
    const value = tag.match(/value=["']([^"']*)/i);
    result[name[1]] = value ? value[1] : '';
  }
  return result;
}
function isLogin(html) { return /luci_password2|name=["']luci_password/i.test(html); }

async function fetchCudy(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      'user-agent': 'Mozilla/5.0 HomeAutomation-Cudy/1.0',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9',
      ...(options.headers || {})
    };
    if (cookie) headers.cookie = cookie;
    const response = await fetch(BASE + path, { ...options, headers, redirect: 'manual', signal: controller.signal });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  } finally { clearTimeout(timer); }
}

async function login(force = false) {
  if (!PASSWORD) throw new Error('CUDY_PASSWORD is not configured');
  if (force) cookie = '';
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const challengeResponse = await fetchCudy('/cgi-bin/luci/');
    const html = await challengeResponse.text();
    const csrf = input(html, '_csrf'), token = input(html, 'token'), salt = input(html, 'salt');
    if (!csrf || !token || !salt) throw new Error('Cudy login challenge fields missing');
    const form = new URLSearchParams({
      _csrf: csrf, token, salt, zonename: 'America/Sao_Paulo',
      timeclock: String(Math.floor(Date.now() / 1000)), luci_username: USER,
      luci_password: digest(digest(PASSWORD + salt) + token), luci_language: 'pt_BR'
    });
    const response = await fetchCudy('/cgi-bin/luci/', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form
    });
    const body = await response.text();
    if (!cookie || response.status >= 400 || isLogin(body) || /senha incorreta|invalid password/i.test(body)) {
      cookie = '';
      throw new Error('Cudy authentication failed');
    }
  })();
  try { await loginPromise; } finally { loginPromise = null; }
}

async function rawPage(path) {
  if (!cookie) await login();
  let response = await fetchCudy(path);
  let html = await response.text();
  if ([301, 302, 401, 403].includes(response.status) || isLogin(html)) {
    await login(true);
    response = await fetchCudy(path);
    html = await response.text();
  }
  if (!response.ok) throw new Error('Cudy returned HTTP ' + response.status + ' for ' + path);
  return html;
}
async function page(path) { return clean(await rawPage(path)); }
async function postFormNoRetry(path, fields, allowDisconnect = false) {
  try {
    const response = await fetchCudy(path, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
    const body = await response.text();
    if ([301, 302, 401, 403].includes(response.status) || isLogin(body)) throw new Error('Cudy session expired during write');
    if (response.status >= 400) throw new Error('Cudy write returned HTTP ' + response.status);
    return body;
  } catch (err) {
    if (allowDisconnect && (err.name === 'AbortError' || /fetch failed|ECONNRESET|socket|terminated/i.test(err.message))) return '';
    throw err;
  }
}

async function applyGuestService() {
  const response = await fetchCudy('/cgi-bin/luci/admin/servicectl/restart/guest,firewall');
  if (!response.ok) throw new Error('Failed to apply guest/firewall services');
  for (let i = 0; i < 30; i++) {
    const state = (await page('/cgi-bin/luci/admin/servicectl/status')).toLowerCase();
    if (state.includes('finish')) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Guest service apply timed out');
}

function guestIface(band) {
  const normalized = String(band || '').toLowerCase().replace(/\s/g, '');
  if (['2.4', '2.4ghz', '24', '2,4'].includes(normalized)) return 'wlan02';
  if (['5', '5ghz'].includes(normalized)) return 'wlan12';
  return null;
}
async function setGuestBand(band, enabled) {
  const iface = guestIface(band);
  if (!iface) throw new Error('Faixa de convidados inválida');
  const html = await rawPage('/cgi-bin/luci/admin/network/wireless/guest');
  const fields = inputs(html);
  const disabledKey = `cbid.wireless.${iface}.disabled`;
  const desired = enabled ? '0' : '1';
  if (fields[disabledKey] === desired) return false;
  const encryption = String(fields[`cbid.wireless.${iface}.encryption`] || '').toLowerCase();
  if (enabled && ['', 'none', 'open'].includes(encryption)) throw new Error('A rede de convidados está sem criptografia; ativação automática recusada');
  fields.timeclock = String(Math.floor(Date.now() / 1000));
  fields['cbi.submit'] = '1';
  fields[`cbi.cbe.wireless.${iface}.disabled`] = '1';
  fields[disabledKey] = desired;
  await postFormNoRetry('/cgi-bin/luci/admin/network/wireless/guest', fields);
  await applyGuestService();
  const verify = inputs(await rawPage('/cgi-bin/luci/admin/network/wireless/guest'));
  if (verify[disabledKey] !== desired) throw new Error('O estado da rede de convidados não foi confirmado');
  return true;
}
async function setGuest(band, enabled) {
  if (writePromise) throw new Error('Já existe uma alteração em andamento');
  writePromise = (async () => {
    if (!band || /todas|ambas/i.test(band)) {
      await setGuestBand('2.4', enabled);
      await setGuestBand('5', enabled);
    } else {
      await setGuestBand(band, enabled);
    }
  })();
  try { await writePromise; } finally { writePromise = null; }
}

async function rebootRouter() {
  if (writePromise) throw new Error('Já existe uma alteração em andamento');
  writePromise = (async () => {
    const html = await rawPage('/cgi-bin/luci/admin/system/reboot');
    const fields = inputs(html);
    if (!fields.token) throw new Error('Token do formulário de reboot não encontrado');
    fields.timeclock = String(Math.floor(Date.now() / 1000));
    fields['cbi.submit'] = '1';
    await postFormNoRetry('/cgi-bin/luci/admin/system/reboot', fields, true);
    cookie = '';
  })();
  try { await writePromise; } finally { writePromise = null; }
}

function concise(s, limit = 360) { return s.slice(0, limit).replace(/\s+/g, ' ').trim(); }
function response(text) { return { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true }; }
function confirmation(text, pendingAction) {
  return { outputSpeech: { type: 'PlainText', text }, reprompt: { outputSpeech: { type: 'PlainText', text: 'Diga confirmar ou cancelar.' } }, shouldEndSession: false, sessionAttributes: { pendingAction } };
}
function slot(handlerInput, name) { return Alexa.getSlotValue(handlerInput.requestEnvelope, name) || ''; }

const launchHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest'; },
  handle() { return response('Posso informar o status da rede, ligar ou desligar a rede de convidados e reiniciar o roteador.'); }
};
const networkStatus = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkStatusIntent'; },
  async handle() {
    try {
      await page('/cgi-bin/luci/admin/system/status');
      const devices = await page('/cgi-bin/luci/admin/network/devices/status');
      const count = devices.match(/(?:clientes|dispositivos|clients|devices)[^0-9]{0,30}(\d+)/i)?.[1];
      return response(count ? `O roteador está acessível e há ${count} dispositivos conectados.` : 'O roteador está acessível pela conexão segura.');
    } catch (err) { console.error('network status failed:', err.message); return response('Não consegui consultar o roteador agora.'); }
  }
};
const detailStatus = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkDetailIntent'; },
  async handle(h) {
    const category = slot(h, 'Category').toLowerCase();
    const source = READ_CAPABILITIES[category] || READ_CAPABILITIES.sistema;
    if (!permitted('read', source.key, true)) return response('Essa consulta está desabilitada.');
    try { return response('Status de ' + source.label + ': ' + concise(await page(source.path)) + '.'); }
    catch (err) { console.error('detail status failed:', err.message); return response('Não consegui consultar ' + source.label + ' agora.'); }
  }
};
const guestControl = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestWifiControlIntent'; },
  handle(h) {
    const action = slot(h, 'Action').toLowerCase();
    const band = slot(h, 'Band') || 'todas';
    if (!permitted('control', 'guest_wifi')) return response('O controle da rede de convidados está desabilitado.');
    if (!['ligar', 'desligar'].includes(action)) return response('Diga ligar ou desligar a rede de convidados.');
    return confirmation(`Você pediu para ${action} a rede de convidados em ${band}. Diga confirmar para executar ou cancelar.`, { type: 'guest', action, band });
  }
};
const rebootHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RouterRebootIntent'; },
  handle() {
    if (!permitted('control', 'reboot')) return response('O reinício remoto está desabilitado.');
    return confirmation('O roteador será reiniciado e a Internet ficará indisponível por alguns instantes. Diga confirmar para executar ou cancelar.', { type: 'reboot' });
  }
};
const confirmationHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['ConfirmActionIntent', 'AMAZON.YesIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  async handle(h) {
    const pending = h.attributesManager.getSessionAttributes().pendingAction;
    if (!pending) return response('Não há nenhuma ação pendente para confirmar.');
    try {
      if (pending.type === 'guest') {
        await setGuest(pending.band, pending.action === 'ligar');
        return response(`Rede de convidados ${pending.action === 'ligar' ? 'ligada' : 'desligada'} com sucesso.`);
      }
      if (pending.type === 'reboot') {
        await rebootRouter();
        return response('Comando de reinicialização enviado ao roteador. A rede ficará indisponível por alguns instantes.');
      }
      return response('A ação pendente não é suportada.');
    } catch (err) {
      console.error('control failed:', err.message);
      return response('Não consegui executar a alteração no roteador. Nenhum comando será repetido automaticamente.');
    }
  }
};
const cancelHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['CancelActionIntent', 'AMAZON.NoIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  handle() { return response('Operação cancelada.'); }
};
const helpHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent'; },
  handle() { return response('Você pode perguntar o status da rede, ligar ou desligar a rede de convidados e pedir para reiniciar o roteador. Alterações exigem confirmação.'); }
};
const fallback = { canHandle() { return true; }, handle() { return response('Não entendi. Tente perguntar o status da rede.'); } };
const skillIdGuard = {
  process(handlerInput) {
    const received = handlerInput.requestEnvelope?.context?.System?.application?.applicationId || handlerInput.requestEnvelope?.session?.application?.applicationId;
    if (!ALEXA_SKILL_ID || received !== ALEXA_SKILL_ID) throw new Error('Unauthorized Alexa application');
  }
};
const skill = Alexa.SkillBuilders.custom()
  .addRequestInterceptors(skillIdGuard)
  .addRequestHandlers(launchHandler, networkStatus, detailStatus, guestControl, rebootHandler, confirmationHandler, cancelHandler, helpHandler, fallback)
  .create();
const adapter = new ExpressAdapter(skill, true, true);
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, skill_id_configured: Boolean(ALEXA_SKILL_ID) }));
app.get('/status', async (_req, res) => {
  try { await page('/cgi-bin/luci/admin/system/status'); res.json({ router_reachable: true }); }
  catch (err) { console.error('status query failed:', err.message); res.status(503).json({ router_reachable: false }); }
});
app.post('/alexa', adapter.getRequestHandlers());
app.listen(3000, '127.0.0.1', () => console.log('cudy-alexa listening'));
