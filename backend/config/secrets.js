/**
 * Centraliza segredos e chaves sensíveis via variáveis de ambiente.
 * Em produção, defina JWT_SECRET, TEF_ENCRYPTION_KEY, LICENSE_MASTER_KEY e ADMIN_SEED_PASSWORD.
 */

const DEV_JWT_FALLBACK = 'cds-dev-jwt-change-in-production';
const LEGACY_LICENSE_KEY = 'CDS_MASTER_KEY_2026';

let jwtWarningShown = false;
let licenseWarningShown = false;

function warnOnce(flag, message) {
  if (flag.value) return;
  flag.value = true;
  console.warn(message);
}

const jwtWarnFlag = { value: false };
const licenseWarnFlag = { value: false };

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    console.error('[SEGURANÇA] JWT_SECRET não definido em produção. Defina a variável de ambiente.');
  } else {
    warnOnce(jwtWarnFlag, '[SEGURANÇA] JWT_SECRET não definido — usando chave de desenvolvimento.');
  }
  return DEV_JWT_FALLBACK;
}

function getLicenseMasterKey() {
  const key = process.env.LICENSE_MASTER_KEY;
  if (key) return key;

  if (process.env.NODE_ENV === 'production') {
    console.error('[SEGURANÇA] LICENSE_MASTER_KEY não definido em produção. Defina a variável de ambiente.');
  } else {
    warnOnce(licenseWarnFlag, '[SEGURANÇA] LICENSE_MASTER_KEY não definido — usando chave legada.');
  }
  return LEGACY_LICENSE_KEY;
}

function getCorsOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
}

function isPrivateLanHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function isCorsOriginAllowed(origin, requestHost) {
  if (!origin) return true;

  if (getCorsOrigins().includes(origin)) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    if (requestHost) {
      const reqHostname = requestHost.split(':')[0].toLowerCase();
      if (hostname === reqHostname) return true;
    }

    if (isPrivateLanHost(hostname)) return true;
  } catch (e) {
    return false;
  }

  return false;
}

module.exports = {
  getJwtSecret,
  getLicenseMasterKey,
  getCorsOrigins,
  isCorsOriginAllowed
};
