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
const TIMEOUT_MS = 8000;
let cookie = '';
let loginPromise = null;

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
  arp: { path: '/cgi-bin/luci/admin/system/status/arp', label: 'dispositivos ARP', key: 'arp' },
  firewall: { path: '/cgi-bin/luci/admin/network/firewall', label: 'firewall', key: 'firewall' },
  upnp: { path: '/cgi-bin/luci/admin/network/upnp', label: 'UPnP', key: 'upnp' },
  igmp: { path: '/cgi-bin/luci/admin/network/igmp', label: 'IGMP', key: 'igmp' }
};
const CONTROL_CAPABILITIES = {
  reboot: 'reboot', convidados: 'guest_wifi', firewall: 'firewall', upnp: 'upnp', igmp: 'igmp',
  port_forward: 'port_forward', wifi_principal: 'wifi_main', wisp: 'wisp', wan: 'wan', vpn: 'vpn',
  dhcp: 'dhcp', firmware: 'firmware', reset: 'factory_reset'
};

function digest(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function clean(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); }
function input(html, name) { const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const match = html.match(new RegExp('<input[^>]*name=[\"\']' + safe + '[\"\'][^>]*>', 'i')); if (!match) return ''; const value = match[0].match(/value=[\"\']([^\"\']*)/i); return value ? value[1] : ''; }
async function fetchCudy(path, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'pt-BR,pt;q=0.9', ...(options.headers || {}) }; if (cookie) headers.cookie = cookie;
    const response = await fetch(BASE + path, { ...options, headers, redirect: 'manual', signal: controller.signal });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  } finally { clearTimeout(timer); }
}
async function login() {
  if (!PASSWORD) throw new Error('CUDY_PASSWORD is not configured');
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const page = await fetchCudy('/cgi-bin/luci/'); const html = await page.text();
    const csrf = input(html, '_csrf'), token = input(html, 'token'), salt = input(html, 'salt');
    if (!csrf || !token || !salt) throw new Error('Cudy challenge fields missing (HTTP ' + page.status + ', field lengths ' + [csrf.length, token.length, salt.length].join('/') + ')');
    const form = new URLSearchParams({ _csrf: csrf, token, salt, zonename: 'America/Sao_Paulo', timeclock: String(Math.floor(Date.now()/1000)), luci_username: USER, luci_password: digest(digest(PASSWORD + salt) + token), luci_language: 'pt_BR' });
    const response = await fetchCudy('/cgi-bin/luci/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    const body = await response.text();
    if (!cookie || /luci_password|senha incorreta|invalid password/i.test(body)) { cookie = ''; throw new Error('Cudy authentication failed'); }
  })();
  try { await loginPromise; } finally { loginPromise = null; }
}
async function page(path) {
  if (!cookie) await login();
  let response = await fetchCudy(path); let html = await response.text();
  if (response.status === 301 || response.status === 302 || response.status === 401 || response.status === 403 || /luci_password2|name=["']luci_password/i.test(html)) {
    cookie = ''; await login(); response = await fetchCudy(path); html = await response.text();
  }
  if (!response.ok) throw new Error('Cudy returned HTTP ' + response.status);
  return clean(html);
}
async function summary() {
  const [system, clients, wisp, vpn] = await Promise.all([
    page('/cgi-bin/luci/admin/system/status'), page('/cgi-bin/luci/admin/network/devices/status'), page('/cgi-bin/luci/admin/network/wireless/wds/status'), page('/cgi-bin/luci/admin/network/vpn/status')
  ]);
  return { system, clients, wisp, vpn };
}
function concise(s, limit = 360) { return s.slice(0, limit).replace(/\s+/g, ' ').trim(); }
function response(text) { return { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true }; }
function confirmation(text, pendingAction) { return { outputSpeech: { type: 'PlainText', text }, reprompt: { outputSpeech: { type: 'PlainText', text: 'Diga confirmar ou cancelar.' } }, shouldEndSession: false, sessionAttributes: { pendingAction } }; }
function slot(handlerInput, name) { return Alexa.getSlotValue(handlerInput.requestEnvelope, name) || ''; }
async function reading(path, label) { return { label, value: concise(await page(path)) }; }
async function statusOverview() {
  // Cudy invalidates or redirects concurrent LuCI requests in the same session.
  // Keep this sequence serialized.
  const values = [];
  values.push(await reading('/cgi-bin/luci/admin/system/status', 'sistema'));
  values.push(await reading('/cgi-bin/luci/admin/network/devices/status', 'dispositivos'));
  values.push(await reading('/cgi-bin/luci/admin/network/wireless/wds/status', 'conexão WISP'));
  values.push(await reading('/cgi-bin/luci/admin/network/vpn/status', 'VPN'));
  return values;
}
const launchHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest'; },
  handle() { return response('Olá. Posso informar o status da rede, Wi-Fi, WISP, VPN, DHCP e dispositivos conectados.'); }
};
const networkStatus = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkStatusIntent'; },
  async handle() { try { await statusOverview(); return response('O roteador está acessível pela conexão segura. Posso também informar sobre Wi-Fi, VPN, WISP, DHCP ou dispositivos conectados.'); } catch (err) { console.error('network status failed:', err.message); return response('Não consegui consultar o roteador agora. A conexão segura com a residência pode estar indisponível.'); } }
};
const detailStatus = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkDetailIntent'; },
  async handle(h) {
    const category = slot(h, 'Category').toLowerCase();
    const source = READ_CAPABILITIES[category] || READ_CAPABILITIES.sistema;
    if (!permitted('read', source.key, true)) return response('A consulta de ' + source.label + ' está desabilitada pela política da skill.');
    try { const text = await page(source.path); return response('Status de ' + source.label + ': ' + concise(text) + '.'); }
    catch (err) { console.error('detail status failed:', err.message); return response('Não consegui consultar ' + source.label + ' agora.'); }
  }
};
const protectedControl = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RouterControlIntent'; },
  handle(h) {
    const target = slot(h, 'Target').toLowerCase().replace(/\s+/g, '_');
    const action = slot(h, 'Action').toLowerCase();
    const capability = CONTROL_CAPABILITIES[target];
    if (!capability) return response('Esse controle não é reconhecido pela política da skill.');
    if (!permitted('control', capability)) return response('A alteração de ' + target.replace(/_/g, ' ') + ' está desabilitada pela política da skill.');
    return confirmation('Você pediu para ' + action + ' ' + target.replace(/_/g, ' ') + '. Diga confirmar para continuar ou cancelar.', { type: target, action });
  }
};
const guestControl = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestWifiControlIntent'; },
  handle(h) {
    const action = slot(h, 'Action').toLowerCase(); const band = slot(h, 'Band') || 'todas as bandas';
    if (!permitted('control', CONTROL_CAPABILITIES.convidados)) return response('O controle do Wi-Fi de convidados está desabilitado pela política da skill.');
    if (!['ligar', 'desligar'].includes(action)) return response('Diga ligar ou desligar o Wi-Fi de convidados.');
    return confirmation('Você pediu para ' + action + ' o Wi-Fi de convidados em ' + band + '. Esta alteração pode desconectar convidados. Diga confirmar para continuar ou cancelar.', { type: 'guest', action, band });
  }
};
const reboot = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RouterRebootIntent'; },
  handle() { if (!permitted('control', CONTROL_CAPABILITIES.reboot)) return response('O reinício remoto está desabilitado pela política da skill.'); return confirmation('Isso reiniciará o roteador e interromperá a Internet temporariamente. Diga confirmar reinício para continuar ou cancelar.', { type: 'reboot' }); }
};
const confirmationHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['ConfirmActionIntent', 'AMAZON.YesIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  handle(h) {
    const pending = h.attributesManager.getSessionAttributes().pendingAction;
    if (!pending) return response('Não há nenhuma ação pendente para confirmar.');
    return response('A ação foi confirmada, mas a execução no Cudy permanece desabilitada até a validação controlada do comando. Nenhuma alteração foi feita.');
  }
};
const cancelHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['CancelActionIntent', 'AMAZON.NoIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  handle() { return response('Operação cancelada. Nenhuma alteração foi feita.'); }
};
const helpHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent'; },
  handle() { return response('Você pode perguntar como está a rede, Wi-Fi, VPN, WISP, DHCP ou dispositivos conectados. Também pode pedir o reinício ou ligar e desligar o Wi-Fi de convidados, com confirmação.'); }
};
const fallback = { canHandle() { return true; }, handle() { return response('Não entendi. Você pode pedir o status da rede.'); } };
const skillIdGuard = {
  process(handlerInput) {
    const received = handlerInput.requestEnvelope?.context?.System?.application?.applicationId
      || handlerInput.requestEnvelope?.session?.application?.applicationId;
    if (!ALEXA_SKILL_ID || received !== ALEXA_SKILL_ID) {
      console.error('Rejected Alexa request with an unrecognized application ID');
      throw new Error('Unauthorized Alexa application');
    }
  }
};
const skill = Alexa.SkillBuilders.custom()
  .addRequestInterceptors(skillIdGuard)
  .addRequestHandlers(launchHandler, networkStatus, detailStatus, protectedControl, guestControl, reboot, confirmationHandler, cancelHandler, helpHandler, fallback)
  .create();
const adapter = new ExpressAdapter(skill, true, true);
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/status', async (_req, res) => { try { await page('/cgi-bin/luci/admin/system/status'); res.json({ router_reachable: true }); } catch (err) { console.error('status query failed:', err.message); res.status(503).json({ router_reachable: false }); } });
app.post('/alexa', adapter.getRequestHandlers());
app.listen(3000, '127.0.0.1', () => console.log('cudy-alexa listening'));