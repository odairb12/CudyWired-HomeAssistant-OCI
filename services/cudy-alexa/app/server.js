const fs = require('node:fs');
const YAML = require('yaml');
const express = require('express');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const HA_URL=(process.env.HA_URL||'http://127.0.0.1:8123').replace(/\/$/,'');
const HA_TOKEN=process.env.HA_TOKEN||'';
const ALEXA_SKILL_ID=process.env.ALEXA_SKILL_ID||'';
const TIMEOUT_MS=10000;
function loadPolicy(){try{return YAML.parse(fs.readFileSync(process.env.POLICY_PATH||'/app/policy.yaml','utf8'))||{};}catch(e){console.error('policy load failed:',e.message);return{};}}
const POLICY=loadPolicy();
function permitted(g,k,f=false){const v=POLICY?.[g]?.[k];return v===undefined?f:v===true;}
const E={
  uptime:process.env.HA_ENTITY_UPTIME||'sensor.cudy_uptime',
  firmware:process.env.HA_ENTITY_FIRMWARE||'sensor.cudy_firmware',
  lan:process.env.HA_ENTITY_LAN_IP||'sensor.cudy_lan_ip',
  clients:process.env.HA_ENTITY_CLIENTS||'sensor.cudy_connected_clients',
  wisp:process.env.HA_ENTITY_WISP||'binary_sensor.cudy_wisp',
  wispSignal:process.env.HA_ENTITY_WISP_SIGNAL||'sensor.cudy_wisp_signal',
  vpn:process.env.HA_ENTITY_VPN||'binary_sensor.cudy_vpn',
  vpnProtocol:process.env.HA_ENTITY_VPN_PROTOCOL||'sensor.cudy_vpn_protocol',
  channel:process.env.HA_ENTITY_WIFI_CHANNEL||'sensor.cudy_wi_fi_channel',
  guest24:process.env.HA_ENTITY_GUEST_24||'switch.cudy_guest_wi_fi_2_4_ghz',
  guest5:process.env.HA_ENTITY_GUEST_5||'switch.cudy_guest_wi_fi_5_ghz',
  guestAll:process.env.HA_ENTITY_GUEST_ALL||'switch.cudy_guest_wi_fi_all',
  reboot:process.env.HA_ENTITY_REBOOT||'button.cudy_reboot_router'
};
async function ha(path,options={}){if(!HA_TOKEN)throw new Error('HA_TOKEN is not configured');const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT_MS);try{const r=await fetch(HA_URL+path,{...options,signal:c.signal,headers:{authorization:`Bearer ${HA_TOKEN}`,'content-type':'application/json',...(options.headers||{})}});const text=await r.text();if(!r.ok)throw new Error(`HA HTTP ${r.status}: ${text.slice(0,120)}`);return text?JSON.parse(text):null;}finally{clearTimeout(t);}}
async function state(id){return ha('/api/states/'+encodeURIComponent(id));}
async function service(domain,name,id){return ha(`/api/services/${domain}/${name}`,{method:'POST',body:JSON.stringify({entity_id:id})});}
function available(s){return s&&!['unknown','unavailable'].includes(String(s.state).toLowerCase());}
function isOn(s){return available(s)&&s.state==='on';}
function spoken(s){return !available(s)?'indisponível':s.state==='on'?'conectado':s.state==='off'?'desconectado':String(s.state);}
async function setGuest(band,enabled){const b=String(band||'todas').toLowerCase().replace(/\s/g,'');let id;if(/todas|ambas/.test(b))id=E.guestAll;else if(['2.4','2,4','2.4ghz','24'].includes(b))id=E.guest24;else if(['5','5ghz'].includes(b))id=E.guest5;else throw new Error('Faixa de convidados inválida');const before=await state(id);if(!available(before))throw new Error(`${id} indisponível`);if(isOn(before)!==enabled)await service('switch',enabled?'turn_on':'turn_off',id);const after=await state(id);if(!available(after)||isOn(after)!==enabled)throw new Error(`HA não confirmou ${id}`);}
async function rebootRouter(){const b=await state(E.reboot);if(!b||b.state==='unavailable')throw new Error('Reboot indisponível');await service('button','press',E.reboot);}
function response(text,keepOpen=false){return{outputSpeech:{type:'PlainText',text},...(keepOpen?{reprompt:{outputSpeech:{type:'PlainText',text:'Deseja consultar mais alguma coisa?'}},shouldEndSession:false}:{shouldEndSession:true})};}
function prompt(text){return{outputSpeech:{type:'PlainText',text},reprompt:{outputSpeech:{type:'PlainText',text:'Você pode perguntar sobre a rede, Wi-Fi, WISP ou VPN.'}},shouldEndSession:false};}
function confirmation(text,pendingAction){return{outputSpeech:{type:'PlainText',text},reprompt:{outputSpeech:{type:'PlainText',text:'Diga confirmar ou cancelar.'}},shouldEndSession:false,sessionAttributes:{pendingAction}};}
function slot(h,n){return Alexa.getSlotValue(h.requestEnvelope,n)||'';}
const launchHandler={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='LaunchRequest',handle:()=>prompt('Posso informar o status da rede, controlar a rede de convidados e reiniciar o roteador. O que deseja consultar?')};
const networkStatus={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&Alexa.getIntentName(h.requestEnvelope)==='NetworkStatusIntent',async handle(){try{const[c,w,v]=await Promise.all([state(E.clients),state(E.wisp),state(E.vpn)]);return response(`Há ${available(c)?c.state:'um número desconhecido de'} dispositivos conectados. O WISP está ${spoken(w)} e a VPN está ${spoken(v)}.`,true);}catch(e){console.error('network status:',e.message);return response('Não consegui consultar o Home Assistant agora.',true);}}};
const detailStatus={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&Alexa.getIntentName(h.requestEnvelope)==='NetworkDetailIntent',async handle(h){const cat=slot(h,'Category').toLowerCase();const map={sistema:[E.uptime,'tempo de atividade'],lan:[E.lan,'IP da LAN'],dispositivos:[E.clients,'dispositivos conectados'],wifi:[E.channel,'canal Wi-Fi'],convidados:[E.guestAll,'rede de convidados'],wisp:[E.wisp,'WISP'],vpn:[E.vpn,'VPN']};const[id,label]=map[cat]||[E.uptime,'tempo de atividade'];try{return response(`${label}: ${spoken(await state(id))}.`,true);}catch(e){return response(`Não consegui consultar ${label} agora.`,true);}}};
const guestControl={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&Alexa.getIntentName(h.requestEnvelope)==='GuestWifiControlIntent',handle(h){const requested=slot(h,'Action').toLowerCase(),action=({ativar:'ligar',habilitar:'ligar',desativar:'desligar'})[requested]||requested,band=slot(h,'Band')||'todas';if(!permitted('control','guest_wifi'))return response('O controle da rede de convidados está desabilitado.');if(!['ligar','desligar'].includes(action))return response('Diga ligar ou desligar a rede de convidados.');return confirmation(`Você pediu para ${action} a rede de convidados em ${band}. Diga confirmar para executar ou cancelar.`,{type:'guest',action,band});}};
const rebootHandler={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&Alexa.getIntentName(h.requestEnvelope)==='RouterRebootIntent',handle(){if(!permitted('control','reboot'))return response('O reinício remoto está desabilitado.');return confirmation('O roteador será reiniciado. Diga confirmar para executar ou cancelar.',{type:'reboot'});}};
const confirmationHandler={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&['ConfirmActionIntent','AMAZON.YesIntent'].includes(Alexa.getIntentName(h.requestEnvelope)),async handle(h){const p=h.attributesManager.getSessionAttributes().pendingAction;if(!p)return response('Não há nenhuma ação pendente para confirmar.');try{if(p.type==='guest'){await setGuest(p.band,p.action==='ligar');return response(`Rede de convidados ${p.action==='ligar'?'ligada':'desligada'} com sucesso.`);}if(p.type==='reboot'){await rebootRouter();return response('O Home Assistant recebeu o comando de reinicialização do roteador.');}return response('A ação pendente não é suportada.');}catch(e){console.error('confirmed action:',e.message);return response('Não consegui executar a ação pelo Home Assistant. Verifique a integração Cudy.');}}};
const cancelHandler={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&['CancelActionIntent','AMAZON.NoIntent','AMAZON.CancelIntent','AMAZON.StopIntent'].includes(Alexa.getIntentName(h.requestEnvelope)),handle:()=>response('Operação cancelada.')};
const helpHandler={canHandle:h=>Alexa.getRequestType(h.requestEnvelope)==='IntentRequest'&&Alexa.getIntentName(h.requestEnvelope)==='AMAZON.HelpIntent',handle:()=>response('Você pode perguntar o status da rede, WISP ou VPN, controlar a rede de convidados ou reiniciar o roteador.',true)};
const fallbackHandler={canHandle:()=>true,handle:()=>response('Não reconheci esse comando. Deseja consultar o status da rede?',true)};
const skillIdGuard={process(h){const received=h.requestEnvelope?.context?.System?.application?.applicationId||h.requestEnvelope?.session?.application?.applicationId;if(!ALEXA_SKILL_ID||received!==ALEXA_SKILL_ID)throw new Error('Unauthorized Alexa application');}};
const errorHandler={canHandle:()=>true,handle(h,e){console.error('alexa error:',e.message);return response('Ocorreu um erro ao processar o comando.');}};
const skill=Alexa.SkillBuilders.custom().addRequestInterceptors(skillIdGuard).addRequestHandlers(launchHandler,networkStatus,detailStatus,guestControl,rebootHandler,confirmationHandler,cancelHandler,helpHandler,fallbackHandler).addErrorHandlers(errorHandler).create();
const app=express();app.disable('x-powered-by');app.get('/health',async(_req,res)=>{try{await ha('/api/');res.json({ok:true,home_assistant:true});}catch(e){res.status(503).json({ok:false,home_assistant:false});}});app.post('/alexa',new ExpressAdapter(skill,true,true).getRequestHandlers());app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('cudy-alexa listening on localhost via Home Assistant'));

