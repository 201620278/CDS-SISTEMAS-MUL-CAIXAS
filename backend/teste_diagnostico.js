const http = require('http');
const db = require('./database');
const bcrypt = require('bcryptjs');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
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
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== PING ===');
  try {
    const ping = await request('GET', '/api/ping');
    console.log(ping.status, ping.json || ping.raw);
  } catch (e) {
    console.error('Servidor offline:', e.message);
  }

  console.log('\n=== LOGIN Diego (senha errada) ===');
  try {
    const login = await request('POST', '/api/auth/login', { username: 'Diego', password: 'senhaerrada' });
    console.log(login.status, login.json || login.raw);
  } catch (e) {
    console.error(e.message);
  }

  console.log('\n=== LOGIN admin ===');
  try {
    const loginAdmin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
    console.log(loginAdmin.status, loginAdmin.json || loginAdmin.raw);
  } catch (e) {
    console.error(e.message);
  }

  console.log('\n=== TERMINAIS/AUTO ===');
  try {
    const term = await request('GET', '/api/terminais/auto?hostname=DESKTOP-TESTE&origem=pdv');
    console.log(term.status, term.json || term.raw);
  } catch (e) {
    console.error(e.message);
  }

  console.log('\n=== SIMULAÇÃO LOGIN SQL (Diego) ===');
  db.get(
    'SELECT * FROM usuarios WHERE username = ? AND COALESCE(ativo, 1) = 1',
    ['Diego'],
    (err, usuario) => {
      console.log('SQL err:', err?.message || null);
      console.log('Usuario:', usuario ? { id: usuario.id, username: usuario.username, role: usuario.role } : null);

      if (usuario) {
        db.all(
          'SELECT permissao FROM usuario_permissoes WHERE usuario_id = ? AND permitido = 1',
          [usuario.id],
          (errPerm, rows) => {
            console.log('Perm err:', errPerm?.message || null);
            console.log('Permissões:', rows);
            process.exit();
          }
        );
      } else {
        process.exit();
      }
    }
  );
}

main();
