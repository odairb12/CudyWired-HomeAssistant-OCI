const crypto = require('node:crypto');
const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');

const BASE = (process.env.CUDY_URL || 'http://192.168.10.1').replace(/\/$/, '');
const USER = process.env.CUDY_USERNAME || 'admin';
const PASSWORD = process.env.CUDY_PASSWORD;
const TIMEOUT_MS = 8000;
let cookie = '';
let loginPromise = null;

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
  if (response.status === 401 || response.status === 403 || /luci_password2|name=["']luci_password/i.test(html)) {
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
  const values = await Promise.all([
    reading('/cgi-bin/luci/admin/system/status', 'sistema'),
    reading('/cgi-bin/luci/admin/network/devices/status', 'dispositivos'),
    reading('/cgi-bin/luci/admin/network/wireless/wds/status', 'conexão WISP'),
    reading('/cgi-bin/luci/admin/network/vpn/status', 'VPN')
  ]);
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
    const sources = {
      lan: ['/cgi-bin/luci/admin/network/lan/status', 'LAN'], wifi: ['/cgi-bin/luci/admin/network/wireless/status', 'Wi-Fi'],
      wisp: ['/cgi-bin/luci/admin/network/wireless/wds/status', 'WISP'], vpn: ['/cgi-bin/luci/admin/network/vpn/status', 'VPN'],
      dhcp: ['/cgi-bin/luci/admin/services/dhcp/status', 'DHCP'], convidados: ['/cgi-bin/luci/admin/network/wireless/guest', 'Wi-Fi de convidados'],
      dispositivos: ['/cgi-bin/luci/admin/network/devices/status', 'dispositivos conectados'], sistema: ['/cgi-bin/luci/admin/system/status', 'sistema']
    };
    const source = sources[category] || sources.sistema;
    try { const text = await page(source[0]); return response('Status de ' + source[1] + ': ' + concise(text) + '.'); }
    catch (err) { console.error('detail status failed:', err.message); return response('Não consegui consultar ' + source[1] + ' agora.'); }
  }
};
const guestControl = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestWifiControlIntent'; },
  handle(h) {
    const action = slot(h, 'Action').toLowerCase(); const band = slot(h, 'Band') || 'todas as bandas';
    if (!['ligar', 'desligar'].includes(action)) return response('Diga ligar ou desligar o Wi-Fi de convidados.');
    return confirmation('Você pediu para ' + action + ' o Wi-Fi de convidados em ' + band + '. Esta alteração pode desconectar convidados. Diga confirmar para continuar ou cancelar.', { type: 'guest', action, band });
  }
};
const reboot = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RouterRebootIntent'; },
  handle() { return confirmation('Isso reiniciará o roteador e interromperá a Internet temporariamente. Diga confirmar reinício para continuar ou cancelar.', { type: 'reboot' }); }
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
const skill = Alexa.SkillBuilders.custom().addRequestHandlers(launchHandler, networkStatus, detailStatus, guestControl, reboot, confirmationHandler, cancelHandler, helpHandler, fallback).create();
const adapter = new ExpressAdapter(skill, true, true);
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/status', async (_req, res) => { try { await page('/cgi-bin/luci/admin/system/status'); res.json({ router_reachable: true }); } catch (err) { console.error('status query failed:', err.message); res.status(503).json({ router_reachable: false }); } });
app.post('/alexa', adapter.getRequestHandlers());
app.listen(3000, '127.0.0.1', () => console.log('cudy-alexa listening'));