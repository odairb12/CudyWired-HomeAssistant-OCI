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
function concise(s) { return s.slice(0, 700); }
function response(text) { return { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true }; }
const handlers = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest'; },
  handle() { return response('Olá. Posso informar o status da sua rede Cudy. Pergunte: como está a rede?'); }
};
const networkStatus = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['NetworkStatusIntent','AMAZON.HelpIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  async handle() { try { const data = await summary(); return response('O roteador está acessível pela VPN. Status do sistema: ' + concise(data.system) + '. Clientes: ' + concise(data.clients) + '.'); } catch (err) { console.error('status query failed:', err.message); return response('Não consegui consultar o roteador agora. A conexão segura com a residência pode estar indisponível.'); } }
};
const fallback = { canHandle() { return true; }, handle() { return response('Não entendi. Você pode perguntar: como está a rede?'); } };
const skill = Alexa.SkillBuilders.custom().addRequestHandlers(handlers, networkStatus, fallback).create();
const adapter = new ExpressAdapter(skill, true, true);
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/status', async (_req, res) => { try { await page('/cgi-bin/luci/admin/system/status'); res.json({ router_reachable: true }); } catch (err) { console.error('status query failed:', err.message); res.status(503).json({ router_reachable: false }); } });
app.post('/alexa', adapter.getRequestHandlers());
app.listen(3000, '127.0.0.1', () => console.log('cudy-alexa listening'));