import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DisconnectReason, fetchLatestBaileysVersion, makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : ''; };
const sessionDir = path.resolve(value('session'));
if (!value('session')) throw new Error('A WhatsApp session directory is required.');
fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

const emit = payload => process.stdout.write(`${JSON.stringify(payload)}\n`);
const logger = pino({ level: 'silent' });
let socket;
let connected = false;
let stopping = false;
let timeout;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timeout);
  try { socket?.end?.(new Error('Pairing process complete.')); } catch { /* socket may already be closed */ }
  setTimeout(() => process.exit(code), 150).unref();
}

async function pair() {
  emit({ event: 'started', session: sessionDir });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  socket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Varadise Agent Platform', 'Chrome', '120.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' })
  });
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', update => {
    if (update.qr) emit({ event: 'qr', qr: update.qr });
    if (update.connection === 'open') {
      connected = true;
      emit({ event: 'connected', user: socket.user || null });
      setTimeout(() => stop(0), 700).unref();
      return;
    }
    if (update.connection !== 'close' || connected || stopping) return;
    const status = update.lastDisconnect?.error?.output?.statusCode;
    if (status === DisconnectReason.restartRequired) {
      clearTimeout(timeout);
      setTimeout(() => pair().catch(cause => { emit({ event: 'error', error: String(cause?.message || cause).slice(0, 300) }); stop(1); }), 500).unref();
      return;
    }
    emit({ event: 'error', error: status === DisconnectReason.loggedOut ? 'WhatsApp rejected or logged out this linked-device session.' : 'WhatsApp pairing disconnected before authorization completed.' });
    stop(1);
  });
  timeout = setTimeout(() => {
    emit({ event: 'error', error: 'WhatsApp pairing expired after five minutes. Start pairing again to receive a new QR code.' });
    stop(1);
  }, 5 * 60 * 1000);
  timeout.unref?.();
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
pair().catch(cause => { emit({ event: 'error', error: String(cause?.message || cause).slice(0, 300) }); stop(1); });
