import http from 'node:http';
import path from 'node:path';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, downloadMediaMessage, generateWAMessageFromContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import { shouldIgnoreUntaggedVoiceMessage } from './whatsapp-message-policy.mjs';

const args = process.argv.slice(2);
const value = (name, fallback = '') => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const port = Number(value('port', '3001'));
const sessionDir = path.resolve(value('session'));
const projectId = value('project');
const callbackUrl = value('callback');
const callbackToken = value('callback-token');
if (!sessionDir || !Number.isInteger(port)) throw new Error('Port and session path are required.');
const logger = pino({ level: 'silent' });

let socket;
let connectionState = 'starting';
let reconnectTimer;
let configTimer;
let stopping = false;
let generation = 0;
let ownJids = new Set();
const typingSessions = new Map();
let bridgeSettings = { captureGroupContext: true, contextMessageLimit: 30, contextRetentionHours: 72, typingEnabled: true, imageIngestionEnabled: true, maximumImageMegabytes: 12, respondToMentions: true, respondToAgentReplies: true, voiceNoteEnabled: true, maximumVoiceNoteMegabytes: 15, maximumVoiceNoteSeconds: 600, captionlessImagesEnabled: true, includeQuotedMessageContext: true, sendFailureMessages: true, quoteAgentReplies: true, markHandledMessagesRead: false, outboundTextChunkCharacters: 3500 };
const inboundStats = { groupMessages: 0, contextMessages: 0, taggedMessages: 0, callbacks: 0, replies: 0, errors: 0, typingStarted: 0, typingStopped: 0, typingErrors: 0, lastContextAt: null, lastTaggedAt: null, lastReplyAt: null, lastTypingAt: null, lastError: null };
const selectedInteractionId = message => {
  if (message?.buttonsResponseMessage?.selectedButtonId) return String(message.buttonsResponseMessage.selectedButtonId);
  if (message?.listResponseMessage?.singleSelectReply?.selectedRowId) return String(message.listResponseMessage.singleSelectReply.selectedRowId);
  if (message?.templateButtonReplyMessage?.selectedId) return String(message.templateButtonReplyMessage.selectedId);
  try {
    const params = message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    const parsed = params ? JSON.parse(params) : null;
    return String(parsed?.id || parsed?.selectedId || '');
  } catch { return ''; }
};
const messageText = message => selectedInteractionId(message) || message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '';
const unwrapMessage = message => message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message?.viewOnceMessageV2?.message || message;
const bareJid = jid => String(jid || '').replace(/:\d+@/, '@');
const sendTextReply = async (groupId, text, item = null) => {
  const value = String(text || '').trim();
  if (!value) return { sent: false, messageIds: [], mode: 'text' };
  const limit = Math.max(500, Number(bridgeSettings.outboundTextChunkCharacters || 3500));
  const messageIds = [];
  for (let offset = 0; offset < value.length; offset += limit) {
    const sent = await connectedSocket().sendMessage(groupId, { text: value.slice(offset, offset + limit) }, item && bridgeSettings.quoteAgentReplies ? { quoted: item } : undefined);
    if (sent?.key?.id) messageIds.push(String(sent.key.id));
  }
  return { sent: messageIds.length > 0, messageIds, mode: 'text' };
};
const sendInteractiveReply = async (groupId, interactive, fallbackText = '', item = null) => {
  if (!interactive || !Array.isArray(interactive.options) || !interactive.options.length) return { sent: false, messageIds: [], mode: 'interactive' };
  try {
    const options = interactive.options.slice(0, 10).map(option => ({ id: String(option.id || ''), title: String(option.title || option.label || '').trim().slice(0, 20) })).filter(option => option.id && option.title);
    if (!options.length) return { sent: false, messageIds: [], mode: 'interactive' };
    const socket = connectedSocket();
    const userJid = bareJid(socket.user?.id || socket.user?.lid || '');
    const messageOptions = { userJid, ...(item && bridgeSettings.quoteAgentReplies ? { quoted: item } : {}) };
    let generated;
    let mode;
    if (interactive.type === 'list' || options.length > 3) {
      mode = 'list';
      generated = generateWAMessageFromContent(groupId, { listMessage: { title: String(interactive.title || 'Choose an option').slice(0, 60), description: String(interactive.body || fallbackText || 'Choose an option').slice(0, 900), footerText: String(interactive.footer || 'Tap an option to continue.').slice(0, 60), buttonText: String(interactive.buttonText || 'Choose').slice(0, 20), sections: [{ title: String(interactive.sectionTitle || 'Options').slice(0, 60), rows: options.map(option => ({ title: option.title, rowId: option.id })) }] } }, messageOptions);
      await socket.relayMessage(groupId, generated.message, { messageId: generated.key.id });
    } else {
      mode = 'buttons';
      generated = generateWAMessageFromContent(groupId, { buttonsMessage: { contentText: String(interactive.body || fallbackText || 'Choose an option').slice(0, 900), footerText: String(interactive.footer || 'Tap an option to continue.').slice(0, 60), buttons: options.map(option => ({ buttonId: option.id, buttonText: { displayText: option.title }, type: 1 })), headerType: 1 } }, messageOptions);
      await socket.relayMessage(groupId, generated.message, { messageId: generated.key.id });
    }
    const messageIds = generated?.key?.id ? [String(generated.key.id)] : [];
    return { sent: messageIds.length > 0, messageIds, mode };
  } catch { return { sent: false, messageIds: [], mode: 'interactive' }; }
};
async function phoneJidFor(jid) {
  const normalized = bareJid(jid);
  if (normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@hosted')) return normalized;
  if (!normalized.endsWith('@lid')) return '';
  try { return bareJid(await connectedSocket().signalRepository?.lidMapping?.getPNForLID(normalized)); }
  catch { return ''; }
}

async function acquireTyping(groupId) {
  let entry = typingSessions.get(groupId);
  if (entry) entry.references += 1;
  else {
    entry = { references: 1, timer: null };
    typingSessions.set(groupId, entry);
    const pulse = async () => {
      try { await connectedSocket().sendPresenceUpdate('composing', groupId); inboundStats.lastTypingAt = new Date().toISOString(); }
      catch { inboundStats.typingErrors += 1; }
    };
    await pulse();
    inboundStats.typingStarted += 1;
    entry.timer = setInterval(pulse, 8_000);
    entry.timer.unref?.();
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    entry.references -= 1;
    if (entry.references > 0) return;
    clearInterval(entry.timer);
    typingSessions.delete(groupId);
    try { await connectedSocket().sendPresenceUpdate('paused', groupId); }
    catch { inboundStats.typingErrors += 1; }
    inboundStats.typingStopped += 1;
  };
}

async function refreshBridgeSettings() {
  if (!callbackUrl || !callbackToken || !projectId) return;
  try {
    const url = new URL('/api/whatsapp/bridge-config', callbackUrl); url.searchParams.set('projectId', projectId);
    const response = await fetch(url, { headers: { 'X-Varadise-Bridge-Token': callbackToken } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) bridgeSettings = { ...bridgeSettings, ...payload };
  } catch { /* retain the last known safe project policy */ }
}

async function forwardGroupMessage(item) {
  const message = unwrapMessage(item.message); const context = message?.extendedTextMessage?.contextInfo || message?.imageMessage?.contextInfo || message?.videoMessage?.contextInfo || message?.audioMessage?.contextInfo || {};
  const mentioned = new Set((context.mentionedJid || []).map(bareJid));
  const groupId = String(item.key?.remoteJid || ''); let content = String(messageText(message) || '').trim();
  if (!item.key?.fromMe && groupId.endsWith('@g.us')) inboundStats.groupMessages += 1;
  const tagged = [...ownJids].some(jid => mentioned.has(jid));
  const quotedParticipant = bareJid(context.participant || '');
  const repliedToAgent = Boolean(context.stanzaId && quotedParticipant && ownJids.has(quotedParticipant));
  const selectionTrigger = Boolean(selectedInteractionId(message));
  const mentionTrigger = tagged && bridgeSettings.respondToMentions !== false;
  const replyTrigger = repliedToAgent && bridgeSettings.respondToAgentReplies !== false;
  const attention = mentionTrigger || replyTrigger || selectionTrigger;
  const voiceMessage = message?.audioMessage;
  const imageMessage = message?.imageMessage;
  if (item.key?.fromMe || !groupId.endsWith('@g.us') || (!content && !voiceMessage && !imageMessage) || !callbackUrl || !callbackToken || !projectId) return;
  // The platform can transcribe voice notes only when the participant has
  // explicitly addressed the agent. Do not forward an untagged, captionless
  // voice note with an empty content field: it cannot be retained as useful
  // context and would otherwise reach the callback only to fail with HTTP
  // 400. Captioned voice messages remain eligible for normal context capture.
  if (shouldIgnoreUntaggedVoiceMessage({ voiceMessage, content, attention })) return;
  if (imageMessage && !content && bridgeSettings.captionlessImagesEnabled === false) return;
  if (attention) { inboundStats.taggedMessages += 1; inboundStats.lastTaggedAt = new Date().toISOString(); }
  const releaseTyping = attention && bridgeSettings.typingEnabled ? await acquireTyping(groupId) : async () => {};
  try {
    if (voiceMessage && attention && bridgeSettings.voiceNoteEnabled === false) { if (bridgeSettings.sendFailureMessages !== false) await sendTextReply(groupId, 'Voice-note transcription is disabled under Platform Settings → Hermes.', item); return; }
    const senderId = bareJid(item.key.participant || '');
    const senderName = String(item.pushName || '').trim().slice(0, 100);
    const senderPhoneId = await phoneJidFor(senderId);
    const quotedMessage = unwrapMessage(context.quotedMessage); const quotedContent = bridgeSettings.includeQuotedMessageContext === false ? '' : String(messageText(quotedMessage) || '').trim().slice(0, 1000);
    let audio = null, image = null;
    if (voiceMessage && attention && bridgeSettings.voiceNoteEnabled !== false) {
      const bytes = await downloadMediaMessage(item, 'buffer', {}, { logger, reuploadRequest: messageToRefresh => connectedSocket().updateMediaMessage(messageToRefresh) });
      if (bytes.length > Number(bridgeSettings.maximumVoiceNoteMegabytes || 15) * 1024 * 1024) throw new Error(`The WhatsApp voice note exceeds the ${Number(bridgeSettings.maximumVoiceNoteMegabytes || 15)} MB transcription limit.`);
      if (Number(voiceMessage.seconds || 0) > Number(bridgeSettings.maximumVoiceNoteSeconds || 600)) throw new Error(`The WhatsApp voice note exceeds the ${Number(bridgeSettings.maximumVoiceNoteSeconds || 600)} second limit.`);
      audio = { dataBase64: bytes.toString('base64'), mimeType: String(voiceMessage.mimetype || 'audio/ogg'), seconds: Number(voiceMessage.seconds || 0) };
    }
    if (imageMessage && bridgeSettings.imageIngestionEnabled && (attention || bridgeSettings.captureGroupContext)) {
      const bytes = await downloadMediaMessage(item, 'buffer', {}, { logger, reuploadRequest: messageToRefresh => connectedSocket().updateMediaMessage(messageToRefresh) });
      if (bytes.length > Number(bridgeSettings.maximumImageMegabytes || 12) * 1024 * 1024) throw new Error(`The WhatsApp image exceeds the ${Number(bridgeSettings.maximumImageMegabytes || 12)} MB project-image limit.`);
      const mimeType = String(imageMessage.mimetype || 'image/jpeg').split(';')[0].trim().toLowerCase();
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'jpg';
      image = { dataBase64: bytes.toString('base64'), mimeType, fileName: `whatsapp-${item.key.id}.${extension}`, width: Number(imageMessage.width || 0), height: Number(imageMessage.height || 0) };
    }
    const response = await fetch(callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Varadise-Bridge-Token': callbackToken }, body: JSON.stringify({ projectId, groupId, messageId: item.key.id, senderId, senderName, senderPhoneId, content, quotedContent, tagged: attention, triggerType: selectionTrigger ? 'selection' : repliedToAgent ? 'reply-to-agent' : tagged ? 'mention' : 'context', audio, image }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (attention && bridgeSettings.sendFailureMessages !== false) await sendTextReply(groupId, `I could not process that ${voiceMessage ? 'voice note' : imageMessage ? 'image' : 'request'}: ${String(payload.error || `platform error ${response.status}`).slice(0, 240)}`, item);
      throw new Error(payload.error || `Agent platform returned HTTP ${response.status}.`);
    }
    inboundStats.callbacks += 1;
    if (payload.captured) { inboundStats.contextMessages += 1; inboundStats.lastContextAt = new Date().toISOString(); }
    if (payload.deliveryHandled || payload.duplicate) {
      // The platform owns outbound delivery and has already persisted WhatsApp's acknowledgement.
    } else if (payload.attachment) {
      const attachment = payload.attachment; const bytes = Buffer.from(String(attachment.dataBase64 || ''), 'base64');
      if (!bytes.length) throw new Error('The generated WhatsApp attachment was empty.');
      const sent = await connectedSocket().sendMessage(groupId, { document: bytes, mimetype: String(attachment.mimeType || 'application/octet-stream'), fileName: String(attachment.fileName || 'agent-deliverable'), caption: String(attachment.caption || '') }, bridgeSettings.quoteAgentReplies ? { quoted: item } : undefined);
      if (!sent?.key?.id) throw new Error('WhatsApp did not acknowledge the generated attachment.');
      inboundStats.replies += 1; inboundStats.lastReplyAt = new Date().toISOString();
    } else if (payload.interactive || payload.reply) {
      // Prefer native clickable buttons/lists for selection prompts. Some
      // WhatsApp clients or Baileys versions reject these payloads, so retain
      // a reliable numbered-text fallback and only count a reply after the
      // transport confirms a message id.
      let delivery = payload.interactive
        ? await sendInteractiveReply(groupId, payload.interactive, payload.reply || '', item)
        : { sent: false, messageIds: [], mode: 'text' };
      if (!delivery.sent) delivery = await sendTextReply(groupId, payload.reply || payload.interactive?.body || 'Please reply with your selection.', item);
      if (!delivery.sent) throw new Error('WhatsApp did not acknowledge the selection prompt.');
      inboundStats.replies += 1; inboundStats.lastReplyAt = new Date().toISOString();
    }
    if (attention && bridgeSettings.markHandledMessagesRead) { try { await connectedSocket().readMessages([item.key]); } catch { /* read receipts are best effort */ } }
  } finally { await releaseTyping(); }
}

async function connect() {
  const currentGeneration = ++generation;
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  ownJids = new Set([state.creds?.me?.id, state.creds?.me?.lid].map(bareJid).filter(Boolean));
  const { version } = await fetchLatestBaileysVersion();
  const nextSocket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Varadise Agent Platform', 'Chrome', '120.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' })
  });
  socket = nextSocket;
  nextSocket.ev.on('creds.update', saveCreds);
  nextSocket.ev.on('messages.upsert', event => { if (event.type !== 'notify') return; for (const item of event.messages || []) forwardGroupMessage(item).catch(cause => { inboundStats.errors += 1; inboundStats.lastError = String(cause.message || cause).slice(0, 240); logger.error({ err: cause }, 'Inbound WhatsApp agent dispatch failed'); }); });
  nextSocket.ev.on('connection.update', update => {
    if (currentGeneration !== generation) return;
    if (update.connection === 'open') { connectionState = 'connected'; ownJids = new Set([...ownJids, socket?.user?.id, socket?.user?.lid].map(bareJid).filter(Boolean)); refreshBridgeSettings(); }
    if (update.connection !== 'close') return;
    connectionState = 'disconnected';
    const reason = update.lastDisconnect?.error?.output?.statusCode;
    if (stopping || reason === DisconnectReason.loggedOut) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect().catch(() => { connectionState = 'error'; }), 1_500);
  });
}

const sendJson = (response, status, payload) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
};
const requestBody = (request, maximumBytes = 1_000_000) => new Promise((resolve, reject) => {
  let raw = '', bytes = 0;
  request.on('data', chunk => { bytes += chunk.length; if (bytes <= maximumBytes) raw += chunk; });
  request.on('end', () => { if (bytes > maximumBytes) return reject(new Error('Request is too large.')); try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON.')); } });
});
const connectedSocket = () => {
  if (!socket || connectionState !== 'connected') throw Object.assign(new Error('This project is not connected to WhatsApp.'), { status: 503 });
  return socket;
};

const server = http.createServer(async (request, response) => {
  try {
    const host = String(request.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) return sendJson(response, 400, { error: 'Project bridge accepts loopback requests only.' });
    const route = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && route.pathname === '/health') return sendJson(response, 200, { status: connectionState, uptime: process.uptime(), queueLength: 0, settings: bridgeSettings, inbound: { ...inboundStats, typingGroups: typingSessions.size } });
    if (request.method === 'GET' && route.pathname === '/groups') {
      const groups = await connectedSocket().groupFetchAllParticipating();
      const result = Object.values(groups).filter(group => group.id?.endsWith('@g.us')).map(group => ({ id: group.id, name: group.subject || group.id, participantCount: Array.isArray(group.participants) ? group.participants.length : 0 })).sort((left, right) => left.name.localeCompare(right.name));
      return sendJson(response, 200, { groups: result });
    }
    if (request.method === 'GET' && route.pathname.startsWith('/chat/')) {
      const chatId = decodeURIComponent(route.pathname.slice('/chat/'.length));
      if (!chatId.endsWith('@g.us')) return sendJson(response, 200, { name: chatId.replace(/@.*/, ''), isGroup: false, participants: [] });
      const group = await connectedSocket().groupMetadata(chatId);
      return sendJson(response, 200, { name: group.subject || chatId, isGroup: true, participants: (group.participants || []).map(participant => participant.id) });
    }
    if (request.method === 'POST' && route.pathname === '/identities') {
      const data = await requestBody(request);
      const jids = [...new Set((Array.isArray(data.jids) ? data.jids : []).map(bareJid).filter(Boolean))].slice(0, 200);
      const identities = {};
      for (const jid of jids) identities[jid] = { phoneJid: await phoneJidFor(jid) || null };
      return sendJson(response, 200, { identities });
    }
    if (request.method === 'POST' && route.pathname === '/send') {
      const data = await requestBody(request, 32_000_000); const attachment = data.attachment;
      if (!String(data.chatId || '').endsWith('@g.us') || (!String(data.message || '').trim() && !attachment && !data.interactive)) return sendJson(response, 400, { error: 'A WhatsApp group ID and message, selection or attachment are required.' });
      let payload;
      if (attachment) {
        const bytes = Buffer.from(String(attachment.dataBase64 || ''), 'base64');
        if (!bytes.length) return sendJson(response, 400, { error: 'The WhatsApp attachment is empty.' });
        payload = { document: bytes, mimetype: String(attachment.mimeType || 'application/octet-stream'), fileName: String(attachment.fileName || 'agent-deliverable'), caption: String(attachment.caption || '') };
      } else if (data.interactive) {
        // Prefer native clickable buttons/lists. Older WhatsApp clients can
        // reject these payloads, so retain a reliable numbered-text fallback.
        let delivery = await sendInteractiveReply(data.chatId, data.interactive, data.message || '');
        let interactiveFallback = false;
        if (!delivery.sent) {
          delivery = await sendTextReply(data.chatId, data.message || data.interactive?.body || 'Please reply with your selection.');
          interactiveFallback = true;
        }
        if (delivery.sent) { inboundStats.replies += 1; inboundStats.lastReplyAt = new Date().toISOString(); }
        return sendJson(response, 200, { success: delivery.sent, messageId: delivery.messageIds[0] || null, messageIds: delivery.messageIds, interactive: !interactiveFallback, interactiveFallback, deliveryMode: delivery.mode, deliveryAcknowledged: delivery.sent });
      } else {
        const delivery = await sendTextReply(data.chatId, data.message);
        if (delivery.sent) { inboundStats.replies += 1; inboundStats.lastReplyAt = new Date().toISOString(); }
        return sendJson(response, 200, { success: delivery.sent, messageId: delivery.messageIds[0] || null, messageIds: delivery.messageIds, interactive: false, deliveryMode: delivery.mode, deliveryAcknowledged: delivery.sent });
      }
      const sent = await connectedSocket().sendMessage(data.chatId, payload);
      const messageIds = sent?.key?.id ? [String(sent.key.id)] : [];
      if (messageIds.length) { inboundStats.replies += 1; inboundStats.lastReplyAt = new Date().toISOString(); }
      return sendJson(response, 200, { success: messageIds.length > 0, messageId: messageIds[0] || null, messageIds, interactive: false, deliveryMode: 'attachment', deliveryAcknowledged: messageIds.length > 0 });
    }
    return sendJson(response, 404, { error: 'Project bridge route not found.' });
  } catch (cause) {
    return sendJson(response, cause.status || 500, { error: cause.message || 'Project bridge request failed.' });
  }
});

const close = () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(reconnectTimer);
  clearInterval(configTimer);
  for (const entry of typingSessions.values()) clearInterval(entry.timer);
  typingSessions.clear();
  try { socket?.end?.(new Error('Project bridge stopped.')); } catch { /* process is closing */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
server.listen(port, '127.0.0.1');
configTimer = setInterval(refreshBridgeSettings, 10_000); configTimer.unref?.();
connect().catch(cause => { connectionState = 'error'; console.error(cause.message); });
