import http from 'node:http';

const args = process.argv.slice(2);
const value = (name, fallback = '') => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };

if (args.includes('--pair-only')) {
  console.log(JSON.stringify({ event: 'started', session: value('session') }));
  setTimeout(() => console.log(JSON.stringify({ event: 'qr', qr: 'mock-whatsapp-linked-device-token' })), 30);
  setTimeout(() => console.log(JSON.stringify({ event: 'connected', user: { id: '85200000000@s.whatsapp.net', name: 'Test account' } })), 500);
  setTimeout(() => process.exit(0), 650);
} else {
  const port = Number(value('port', '3001'));
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') return response.end(JSON.stringify({ status: 'connected', queueLength: 0, uptime: 1, inbound: { groupMessages: 1, taggedMessages: 1, typingStarted: 1, typingStopped: 1, typingErrors: 0, typingGroups: 0 } }));
    if (request.method === 'GET' && request.url === '/groups') return response.end(JSON.stringify({ groups: [{ id: '120363000000000000@g.us', name: 'Managed test group', participantCount: 1 }] }));
    if (request.method === 'GET' && request.url.startsWith('/chat/')) return response.end(JSON.stringify({ name: 'Managed test group', isGroup: true, participants: ['one@s.whatsapp.net'] }));
    if (request.method === 'POST' && request.url === '/identities') return response.end(JSON.stringify({ identities: {} }));
    if (request.method === 'POST' && request.url === '/send') return response.end(JSON.stringify({ success: true, messageId: 'managed-wamid-1', received: raw ? JSON.parse(raw) : null }));
    response.statusCode = 404;
    return response.end(JSON.stringify({ error: 'Unknown mock route' }));
  });
  server.listen(port, '127.0.0.1');
}
