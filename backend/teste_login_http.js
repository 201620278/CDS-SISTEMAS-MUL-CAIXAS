const http = require('http');

function post(path, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 3001, path, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Login JSON inválido:');
  const bad = await post('/api/auth/login', '{\\', 'application/json');
  console.log(bad.status, bad.json || bad.raw);

  console.log('\nLogin body vazio:');
  const empty = await post('/api/auth/login', {});
  console.log(empty.status, empty.json || empty.raw);
}

main().catch(console.error);
