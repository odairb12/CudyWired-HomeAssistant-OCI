const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');

const HA_URL = (process.env.HA_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const ALEXA_SKILL_ID = process.env.ALEXA_SKILL_ID || '';
const TIMEOUT_MS = 10000;
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;
const SCHEDULE_PATH = process.env.SCHEDULE_PATH || '/data/guest-schedules.json';
const MAX_GUEST_SCHEDULES = 3;
const MIN_GUEST_DURATION_MS = 60 * 1000;
const MAX_GUEST_DURATION_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_RETRY_MS = 60 * 1000;
const TIME_ZONE = process.env.TIME_ZONE || 'America/Sao_Paulo';
const pendingActions = new Map();
const scheduleTimers = new Map();
let guestSchedules = [];
let scheduleMutation = Promise.resolve();

function mutateSchedules(operation) {
  const result = scheduleMutation.then(operation, operation);
  scheduleMutation = result.catch(() => undefined);
  return result;
}

function loadPolicy() {
  try { return YAML.parse(fs.readFileSync(process.env.POLICY_PATH || '/app/policy.yaml', 'utf8')) || {}; }
  catch (error) { console.error('policy load failed:', error.message); return {}; }
}
const POLICY = loadPolicy();
function permitted(group, key, fallback = false) { const value = POLICY?.[group]?.[key]; return value === undefined ? fallback : value === true; }

const E = {
  uptime: process.env.HA_ENTITY_UPTIME || 'sensor.cudy_uptime', firmware: process.env.HA_ENTITY_FIRMWARE || 'sensor.cudy_firmware',
  lan: process.env.HA_ENTITY_LAN_IP || 'sensor.cudy_lan_ip', clients: process.env.HA_ENTITY_CLIENTS || 'sensor.cudy_connected_clients',
  wisp: process.env.HA_ENTITY_WISP || 'binary_sensor.cudy_wisp', wispSignal: process.env.HA_ENTITY_WISP_SIGNAL || 'sensor.cudy_wisp_signal',
  vpn: process.env.HA_ENTITY_VPN || 'binary_sensor.cudy_vpn', vpnProtocol: process.env.HA_ENTITY_VPN_PROTOCOL || 'sensor.cudy_vpn_protocol',
  channel: process.env.HA_ENTITY_WIFI_CHANNEL || 'sensor.cudy_wi_fi_channel', guest24: process.env.HA_ENTITY_GUEST_24 || 'switch.cudy_guest_wi_fi_2_4_ghz',
  guest5: process.env.HA_ENTITY_GUEST_5 || 'switch.cudy_guest_wi_fi_5_ghz', guestAll: process.env.HA_ENTITY_GUEST_ALL || 'switch.cudy_guest_wi_fi_all',
  reboot: process.env.HA_ENTITY_REBOOT || 'button.cudy_reboot_router',
};
const CHECKUP = [
  ['Internet e WISP', E.wisp], ['VPN', E.vpn], ['LAN', process.env.HA_ENTITY_LAN_STATUS || 'binary_sensor.cudy_lan'],
  ['Wi-Fi 2,4 gigahertz', process.env.HA_ENTITY_WIFI_24_STATUS || 'binary_sensor.cudy_wi_fi_2_4_ghz'],
  ['Wi-Fi 5 gigahertz', process.env.HA_ENTITY_WIFI_5_STATUS || 'binary_sensor.cudy_wi_fi_5_ghz'],
  ['Mesh', process.env.HA_ENTITY_MESH_STATUS || 'binary_sensor.cudy_mesh'], ['DHCP', process.env.HA_ENTITY_DHCP_STATUS || 'binary_sensor.cudy_dhcp'],
];

async function ha(apiPath, options = {}) {
  if (!HA_TOKEN) throw new Error('HA_TOKEN is not configured');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await fetch(HA_URL + apiPath, { ...options, signal: controller.signal, headers: { authorization: `Bearer ${HA_TOKEN}`, 'content-type': 'application/json', ...(options.headers || {}) } });
    const text = await result.text(); if (!result.ok) throw new Error(`HA HTTP ${result.status}: ${text.slice(0, 120)}`); return text ? JSON.parse(text) : null;
  } finally { clearTimeout(timer); }
}
async function state(entityId) { return ha('/api/states/' + encodeURIComponent(entityId)); }
async function service(domain, name, entityId) { return ha(`/api/services/${domain}/${name}`, { method: 'POST', body: JSON.stringify({ entity_id: entityId }) }); }
function available(entityState) { return entityState && !['unknown', 'unavailable'].includes(String(entityState.state).toLowerCase()); }
function isOn(entityState) { return available(entityState) && entityState.state === 'on'; }
function spoken(entityState) { if (!available(entityState)) return 'indisponível'; if (entityState.state === 'on') return 'conectado'; if (entityState.state === 'off') return 'desconectado'; return String(entityState.state); }
function spokenFeminine(entityState) { if (!available(entityState)) return 'indisponível'; if (entityState.state === 'on') return 'conectada'; if (entityState.state === 'off') return 'desconectada'; return String(entityState.state); }

function normalizeBand(value) {
  const band = String(value || 'todas').toLowerCase().replace(/\s/g, '').replace(',', '.');
  if (/^(todas|ambas|todos|all)$/.test(band)) return 'todas';
  if (/^(2\.4|2\.4ghz|24|2ghz)$/.test(band)) return '2.4';
  if (/^(5|5ghz)$/.test(band)) return '5';
  throw new Error('invalid guest band');
}
function expandedBands(band) { return normalizeBand(band) === 'todas' ? ['2.4', '5'] : [normalizeBand(band)]; }
async function setGuest(band, enabled) {
  const normalized = normalizeBand(band); const entityId = normalized === 'todas' ? E.guestAll : normalized === '2.4' ? E.guest24 : E.guest5;
  const before = await state(entityId); if (!available(before)) throw new Error('guest entity unavailable');
  if (isOn(before) !== enabled) await service('switch', enabled ? 'turn_on' : 'turn_off', entityId);
  const after = await state(entityId); if (!available(after) || isOn(after) !== enabled) throw new Error('guest state not confirmed');
}

function saveSchedules() {
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true }); const temporaryPath = `${SCHEDULE_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(guestSchedules, null, 2)); fs.renameSync(temporaryPath, SCHEDULE_PATH);
}
function loadSchedules() {
  try { const loaded = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')); guestSchedules = Array.isArray(loaded) ? loaded.filter((item) => item && item.id && Number.isFinite(item.due) && item.band) : []; }
  catch { guestSchedules = []; }
}
function clearScheduleTimer(id) { const timer = scheduleTimers.get(id); if (timer) clearTimeout(timer); scheduleTimers.delete(id); }
function isBandLeased(band) { const now = Date.now(); return guestSchedules.some((item) => item.due > now && expandedBands(item.band).includes(band)); }
async function finishSchedule(item) {
  clearScheduleTimer(item.id); guestSchedules = guestSchedules.filter((entry) => entry.id !== item.id); saveSchedules();
  const bandsToDisable = expandedBands(item.band).filter((band) => !isBandLeased(band));
  try {
    if (bandsToDisable.length === 2) await setGuest('todas', false); else for (const band of bandsToDisable) await setGuest(band, false);
    console.log(`guest schedule completed id=${item.id}`);
  } catch (error) {
    console.error(`guest schedule failed id=${item.id}: ${error.message}`); const retry = { ...item, due: Date.now() + SCHEDULE_RETRY_MS, retry: true };
    guestSchedules.push(retry); saveSchedules(); armSchedule(retry);
  }
}
function armSchedule(item) { clearScheduleTimer(item.id); const delay = Math.max(0, item.due - Date.now()); scheduleTimers.set(item.id, setTimeout(() => mutateSchedules(() => finishSchedule(item)), Math.min(delay, 2147483647))); }
async function scheduleGuest(band, durationMs) {
  return mutateSchedules(async () => {
    const normalized = normalizeBand(band);
    if (!Number.isFinite(durationMs) || durationMs < MIN_GUEST_DURATION_MS || durationMs > MAX_GUEST_DURATION_MS) throw new Error('invalid guest duration');
    if (guestSchedules.length >= MAX_GUEST_SCHEDULES) throw new Error('schedule limit reached');
    await setGuest(normalized, true);
    const item = { id: crypto.randomUUID(), band: normalized, createdAt: Date.now(), due: Date.now() + durationMs };
    guestSchedules.push(item); saveSchedules(); armSchedule(item); return item;
  });
}
async function cancelSchedules(band = 'todas') {
  return mutateSchedules(async () => {
    const normalized = normalizeBand(band); const targets = expandedBands(normalized);
    const removed = guestSchedules.filter((item) => expandedBands(item.band).some((candidate) => targets.includes(candidate)));
    // Preserve the schedules if the router refuses the state change. This way
    // an enabled guest network never loses its automatic shutdown protection.
    await setGuest(normalized, false);
    for (const item of removed) clearScheduleTimer(item.id);
    guestSchedules = guestSchedules.filter((item) => !removed.includes(item)); saveSchedules(); return removed.length;
  });
}

function parseDuration(value) {
  const input = String(value || '').trim().toUpperCase(); const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(input);
  if (!match) return null;
  const milliseconds = (((Number(match[1] || 0) * 24 + Number(match[2] || 0)) * 60 + Number(match[3] || 0)) * 60 + Number(match[4] || 0)) * 1000;
  return milliseconds || null;
}
function humanDuration(milliseconds) {
  const totalMinutes = Math.round(milliseconds / 60000); const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60; const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`); if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
  return parts.join(' e ') || 'menos de um minuto';
}
function spokenTime(timestamp) { return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
function scheduleSummary() {
  const active = guestSchedules.filter((item) => item.due > Date.now()).sort((a, b) => a.due - b.due);
  if (!active.length) return 'Não há agendamentos ativos para a rede de convidados.';
  const descriptions = active.map((item) => `${item.band === 'todas' ? 'nas duas faixas' : `na faixa de ${item.band} gigahertz`}, por mais ${humanDuration(Math.max(MIN_GUEST_DURATION_MS, item.due - Date.now()))}, até ${spokenTime(item.due)}`);
  return `Há ${active.length} ${active.length === 1 ? 'agendamento ativo' : 'agendamentos ativos'}: ${descriptions.join('; ')}.`;
}
async function rebootRouter() { const button = await state(E.reboot); if (!button || button.state === 'unavailable') throw new Error('reboot unavailable'); await service('button', 'press', E.reboot); }

const MORE_HELP_QUESTION = 'Deseja saber mais alguma coisa do seu roteador?';
function response(text, keepOpen = false) {
  if (!keepOpen) return { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true };
  return {
    outputSpeech: { type: 'PlainText', text: `${text} ${MORE_HELP_QUESTION}` },
    reprompt: { outputSpeech: { type: 'PlainText', text: 'Se quiser continuar, diga sim. Para encerrar, diga não.' } },
    shouldEndSession: false,
  };
}
function prompt(text, reprompt = 'Você pode responder com uma duração, por exemplo, duas horas ou trinta minutos.') { return { outputSpeech: { type: 'PlainText', text }, reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } }, shouldEndSession: false }; }
function confirmation(text, pendingAction) { return { outputSpeech: { type: 'PlainText', text }, reprompt: { outputSpeech: { type: 'PlainText', text: 'Diga sim para confirmar ou não para cancelar.' } }, shouldEndSession: false, sessionAttributes: { pendingAction } }; }
async function progressiveResponse(handlerInput, text) {
  const system = handlerInput.requestEnvelope?.context?.System || {}; const requestId = handlerInput.requestEnvelope?.request?.requestId;
  if (!system.apiEndpoint || !system.apiAccessToken || !requestId) return;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const result = await fetch(`${system.apiEndpoint}/v1/directives`, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${system.apiAccessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ header: { requestId }, directive: { type: 'VoicePlayer.Speak', speech: text } }) });
    if (!result.ok) console.warn(`progressive response HTTP ${result.status}`);
  } catch (error) { console.warn(`progressive response failed: ${error.name || error.message}`); } finally { clearTimeout(timer); }
}
function pendingKey(h) { return h.requestEnvelope?.context?.System?.user?.userId || h.requestEnvelope?.session?.user?.userId || ''; }
function rememberPending(h, action) { const key = pendingKey(h); if (key) pendingActions.set(key, { action, expiresAt: Date.now() + PENDING_ACTION_TTL_MS }); h.attributesManager.setSessionAttributes({ pendingAction: action }); }
function readPending(h) {
  const fromSession = h.attributesManager.getSessionAttributes().pendingAction; if (fromSession) return fromSession;
  const key = pendingKey(h); const entry = key && pendingActions.get(key); if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { pendingActions.delete(key); return null; } return entry.action;
}
function clearPending(h) { const key = pendingKey(h); if (key) pendingActions.delete(key); h.attributesManager.setSessionAttributes({}); }
function slot(h, name) { const value = Alexa.getSlotValue(h.requestEnvelope, name) || ''; return name === 'Action' ? normalizeGuestAction(value) : value; }
function durationConfirmation(h, band, durationValue) {
  const durationMs = parseDuration(durationValue);
  if (!durationMs || durationMs < MIN_GUEST_DURATION_MS || durationMs > MAX_GUEST_DURATION_MS) { rememberPending(h, { type: 'guest_duration', band }); return prompt('O período deve ser de um minuto até vinte e quatro horas. Por quanto tempo devo manter a rede ligada?'); }
  const pending = { type: 'guest_timed', band: normalizeBand(band), durationMs }; rememberPending(h, pending);
  return confirmation(`Combinado. Vou deixar a rede de convidados ligada por ${humanDuration(durationMs)}. Você confirma a operação de ativação?`, pending);
}

const launchHandler = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest', handle: () => prompt('Olá. Posso fazer um check-up da rede, consultar os serviços, ou controlar a rede de convidados. O que você gostaria de fazer?', 'Você pode dizer, por exemplo: faça um check-up da rede.') };
const networkStatus = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkStatusIntent', async handle() { try { const [clients, wisp, vpn] = await Promise.all([state(E.clients), state(E.wisp), state(E.vpn)]); return response(`Há ${available(clients) ? clients.state : 'um número desconhecido de'} dispositivos conectados. O WISP está ${spoken(wisp)} e a VPN está ${spokenFeminine(vpn)}.`, true); } catch (error) { console.error('network status:', error.message); return response('Não consegui consultar a rede neste momento. Podemos tentar novamente em alguns instantes.', true); } } };
const detailStatus = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkDetailIntent', async handle(h) { const category = slot(h, 'Category').toLowerCase(); const map = { sistema: [E.uptime, 'tempo de atividade'], lan: [E.lan, 'IP da LAN'], dispositivos: [E.clients, 'dispositivos conectados'], wifi: [E.channel, 'canal Wi-Fi'], convidados: [E.guestAll, 'rede de convidados'], wisp: [E.wisp, 'WISP'], vpn: [E.vpn, 'VPN'], dhcp: [process.env.HA_ENTITY_DHCP_STATUS || 'binary_sensor.cudy_dhcp', 'DHCP'], mesh: [process.env.HA_ENTITY_MESH_STATUS || 'binary_sensor.cudy_mesh', 'Mesh'] }; const [entityId, label] = map[category] || [E.uptime, 'tempo de atividade']; try { const entityState = await state(entityId); const value = category === 'vpn' ? spokenFeminine(entityState) : spoken(entityState); return response(`${label}: ${value}.`, true); } catch { return response(`Não consegui consultar ${label} agora.`, true); } } };
const healthCheck = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'NetworkHealthIntent', async handle() { const results = await Promise.all(CHECKUP.map(async ([label, entityId]) => { try { return [label, await state(entityId)]; } catch { return [label, null]; } })); const problems = [], unknown = []; for (const [label, entityState] of results) { if (!available(entityState)) unknown.push(label); else if (entityState.state !== 'on') problems.push(label); } if (problems.length) return response(`O check-up encontrou ${problems.length === 1 ? 'um serviço indisponível' : 'serviços indisponíveis'}: ${problems.join(', ')}.${unknown.length ? ` Também não consegui confirmar: ${unknown.join(', ')}.` : ''}`, true); if (unknown.length) return response(`Não encontrei falhas confirmadas, mas não consegui verificar: ${unknown.join(', ')}.`, true); return response('O check-up está normal. Internet, WISP, Mesh, LAN, Wi-Fi, VPN e DHCP estão ativos.', true); } };

const guestControl = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestWifiControlIntent', handle(h) { const requested = slot(h, 'Action').toLowerCase(); const action = ({ ativar: 'ligar', habilitar: 'ligar', desativar: 'desligar' })[requested] || requested; const band = normalizeBand(slot(h, 'Band') || 'todas'); if (!permitted('control', 'guest_wifi')) return response('O controle da rede de convidados está desabilitado.'); if (!['ligar', 'desligar'].includes(action)) return response('Diga ligar ou desligar a rede de convidados.', true); if (action === 'ligar') { const pending = { type: 'guest_duration', band }; rememberPending(h, pending); return prompt('Certo. Por quanto tempo você quer deixar a rede de convidados disponível?'); } const pending = { type: 'guest_off', band }; rememberPending(h, pending); return confirmation('Combinado. Vou desligar a rede de convidados e cancelar os agendamentos correspondentes. Você confirma a operação de desativação?', pending); } };
const guestTimed = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestWifiTimedIntent', handle(h) { if (!permitted('control', 'guest_wifi')) return response('O controle da rede de convidados está desabilitado.'); return durationConfirmation(h, slot(h, 'Band') || 'todas', slot(h, 'Duration')); } };
const guestDuration = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestDurationIntent', handle(h) { const pending = readPending(h); if (!pending || pending.type !== 'guest_duration') return response('Primeiro me peça para ligar a rede de convidados.', true); return durationConfirmation(h, pending.band, slot(h, 'Duration')); } };
const guestScheduleStatus = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestScheduleStatusIntent', handle: () => response(scheduleSummary(), true) };
const guestScheduleCancel = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'GuestScheduleCancelIntent', handle(h) { if (!guestSchedules.length) return response('Não há agendamentos ativos para cancelar.', true); const pending = { type: 'cancel_schedules', band: 'todas' }; rememberPending(h, pending); return confirmation('Vou cancelar os agendamentos e desligar a rede de convidados. Você confirma o cancelamento?', pending); } };
const rebootHandler = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RouterRebootIntent', handle(h) { if (!permitted('control', 'reboot')) return response('O reinício remoto está desabilitado.'); const pending = { type: 'reboot' }; rememberPending(h, pending); return confirmation('O roteador será reiniciado e a rede ficará indisponível por alguns minutos. Você confirma a reinicialização?', pending); } };

const confirmationHandler = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['ConfirmActionIntent', 'AMAZON.YesIntent'].includes(Alexa.getIntentName(h.requestEnvelope)), async handle(h) {
  const pending = readPending(h);
  if (!pending) return prompt('Ótimo, vamos lá. O que você deseja fazer?', 'Você pode pedir um check-up, consultar um serviço ou controlar a rede de convidados.');
  clearPending(h);
  try {
    if (pending.type === 'guest_timed') { await progressiveResponse(h, 'Certo, estou aplicando a alteração. Aguarde um instante.'); const item = await scheduleGuest(pending.band, pending.durationMs); return response(`Pronto. A rede de convidados está ligada e será desligada às ${spokenTime(item.due)}.`, true); }
    if (pending.type === 'guest_off' || pending.type === 'cancel_schedules') { await progressiveResponse(h, 'Certo, estou aplicando a alteração. Aguarde um instante.'); await cancelSchedules(pending.band); return response('Pronto. A rede de convidados foi desligada e os agendamentos correspondentes foram cancelados.', true); }
    if (pending.type === 'reboot') { await progressiveResponse(h, 'Certo, estou iniciando o reinício do roteador. Aguarde um instante.'); await rebootRouter(); return response('O comando de reinicialização foi enviado. O roteador pode ficar indisponível por alguns minutos.', true); }
    return response('A ação pendente expirou. Faça o pedido novamente.', true);
  } catch (error) {
    console.error('confirmed action:', error.message);
    if (error.message === 'schedule limit reached') return response('Já existem três agendamentos ativos. Cancele um deles antes de criar outro.', true);
    if (error.message === 'invalid guest duration') return response('O período deve ser de um minuto até vinte e quatro horas.', true);
    return response('Não consegui concluir a alteração agora. A configuração anterior foi preservada; tente novamente em alguns instantes.', true);
  }
} };
const cancelHandler = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['CancelActionIntent', 'AMAZON.NoIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(Alexa.getIntentName(h.requestEnvelope)), handle(h) {
  const intent = Alexa.getIntentName(h.requestEnvelope); const pending = readPending(h); clearPending(h);
  if (pending) return response('Tudo bem. A operação foi cancelada.');
  if (intent === 'AMAZON.NoIntent') return response('Tudo bem. Até logo.');
  return response('Certo. Encerrando o meu roteador.');
} };
const helpHandler = { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent', handle: () => response('Você pode pedir um check-up, consultar WISP ou VPN, ligar a rede de convidados por um período, consultar os agendamentos ou reiniciar o roteador.', true) };
const fallbackHandler = { canHandle: () => true, handle: () => response('Não entendi. Você pode dizer: faça um check-up da rede, ou: ligue a rede de convidados por duas horas.', true) };
const requestLogger = { process(h) { const request = h.requestEnvelope?.request || {}; const intent = request.intent?.name ? ` intent=${request.intent.name}` : ''; const slots = Object.values(request.intent?.slots || {}).map((entry) => `${entry.name}=${String(entry.value || '').slice(0, 80)}`).join(','); console.log(`alexa request type=${request.type || 'unknown'}${intent}${slots ? ` slots=${slots}` : ''}`); } };
const skillIdGuard = { process(h) { const received = h.requestEnvelope?.context?.System?.application?.applicationId || h.requestEnvelope?.session?.application?.applicationId; if (!ALEXA_SKILL_ID || received !== ALEXA_SKILL_ID) throw new Error('Unauthorized Alexa application'); } };
const errorHandler = { canHandle: () => true, handle(_h, error) { console.error('alexa error:', error.message); return response('Ocorreu um erro ao processar o comando. Tente novamente em alguns instantes.'); } };

function createSkill() {
  return Alexa.SkillBuilders.custom().addRequestInterceptors(requestLogger, skillIdGuard).addRequestHandlers(launchHandler, networkStatus, detailStatus, healthCheck, guestControl, guestTimed, guestDuration, guestScheduleStatus, guestScheduleCancel, rebootHandler, confirmationHandler, cancelHandler, helpHandler, fallbackHandler).addErrorHandlers(errorHandler).create();
}
function createApp() {
  const skill = createSkill();
  const app = express(); app.disable('x-powered-by');
  app.get('/health', async (_request, result) => { try { await ha('/api/'); result.json({ ok: true, home_assistant: true }); } catch { result.status(503).json({ ok: false, home_assistant: false }); } });
  app.post('/alexa', new ExpressAdapter(skill, true, true).getRequestHandlers()); return app;
}
function normalizeGuestAction(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const actions = {
    ligar: 'ligar', liga: 'ligar', ligue: 'ligar', ativar: 'ligar', ative: 'ligar',
    habilitar: 'ligar', habilite: 'ligar', acender: 'ligar', acenda: 'ligar',
    desligar: 'desligar', desliga: 'desligar', desligue: 'desligar', desativar: 'desligar',
    desative: 'desligar', desabilitar: 'desligar', desabilite: 'desligar',
    apagar: 'desligar', apague: 'desligar',
  };
  return actions[normalized] || normalized;
}
function initializeSchedules() { loadSchedules(); for (const item of guestSchedules) armSchedule(item); }
function startServer(port = Number(process.env.PORT || 3000)) {
  initializeSchedules();
  return createApp().listen(port, '127.0.0.1', () => console.log(`cudy-alexa listening on 127.0.0.1:${port} via Home Assistant`));
}
if (require.main === module) startServer();
module.exports = { createSkill, expandedBands, humanDuration, normalizeBand, normalizeGuestAction, parseDuration, response, scheduleSummary, spokenTime, startServer };
