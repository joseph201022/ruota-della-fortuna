const crypto = require('crypto')
const { promisify } = require('util')

const scryptAsync = promisify(crypto.scrypt)

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CLOUDFLARE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID
const CLOUDFLARE_D1_API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN

const D1_API_URL =
  CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_D1_DATABASE_ID
    ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`
    : ''

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

function isD1Configured() {
  return Boolean(
    CLOUDFLARE_ACCOUNT_ID &&
      CLOUDFLARE_D1_DATABASE_ID &&
      CLOUDFLARE_D1_API_TOKEN
  )
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function validateUsername(username) {
  if (!USERNAME_PATTERN.test(username)) {
    const error = new Error(
      'Lo username deve contenere da 3 a 32 caratteri: lettere, numeri, punto, trattino o underscore.'
    )
    error.statusCode = 400
    throw error
  }
}

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    const error = new Error(
      `La password deve contenere da ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caratteri.`
    )
    error.statusCode = 400
    throw error
  }
}

async function queryD1(sql, params = []) {
  if (!isD1Configured()) {
    const error = new Error('Database amministratori non configurato.')
    error.statusCode = 503
    throw error
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(D1_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_D1_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: controller.signal,
    })

    const payload = await response.json().catch(() => null)
    const statement = payload?.result?.[0]

    if (!response.ok || !payload?.success || !statement?.success) {
      const details =
        payload?.errors?.[0]?.message ||
        statement?.error ||
        `Cloudflare D1 ha risposto con stato ${response.status}.`

      throw new Error(details)
    }

    return {
      rows: Array.isArray(statement.results) ? statement.results : [],
      meta: statement.meta || {},
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function hashPassword(password, { enforcePolicy = true } = {}) {
  if (enforcePolicy) {
    validatePassword(password)
  } else if (typeof password !== 'string' || password.length < 6) {
    throw new Error('La password iniziale deve contenere almeno 6 caratteri.')
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = await scryptAsync(password, salt, 64)

  return {
    salt,
    hash: hash.toString('hex'),
  }
}

async function verifyPassword(password, salt, expectedHash) {
  if (
    typeof password !== 'string' ||
    !salt ||
    !expectedHash
  ) {
    return false
  }

  const actualHash = await scryptAsync(password, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')

  return (
    actualHash.length === expected.length &&
    crypto.timingSafeEqual(actualHash, expected)
  )
}

function publicAdmin(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    lastLoginAt: row.last_login_at || null,
  }
}

async function findAdmin(username) {
  const normalized = normalizeUsername(username)
  validateUsername(normalized)

  const { rows } = await queryD1(
    `SELECT id, username, password_hash, password_salt, role, active,
            created_at, created_by, last_login_at
       FROM admin_users
      WHERE username = ?1 COLLATE NOCASE
      LIMIT 1`,
    [normalized]
  )

  return rows[0] || null
}

async function createAdmin({
  username,
  password,
  role = 'admin',
  createdBy,
  enforcePasswordPolicy = true,
}) {
  const normalized = normalizeUsername(username)
  validateUsername(normalized)

  if (enforcePasswordPolicy) {
    validatePassword(password)
  }

  if (!['admin', 'superadmin'].includes(role)) {
    const error = new Error('Ruolo amministratore non valido.')
    error.statusCode = 400
    throw error
  }

  const existing = await findAdmin(normalized)

  if (existing) {
    const error = new Error('Questo username è già utilizzato.')
    error.statusCode = 409
    throw error
  }

  const passwordData = await hashPassword(password, {
    enforcePolicy: enforcePasswordPolicy,
  })
  const admin = {
    id: crypto.randomUUID(),
    username: normalized,
    role,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
  }

  await queryD1(
    `INSERT INTO admin_users
      (id, username, password_hash, password_salt, role, active,
       created_at, created_by, last_login_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, NULL)`,
    [
      admin.id,
      admin.username,
      passwordData.hash,
      passwordData.salt,
      admin.role,
      admin.createdAt,
      admin.createdBy,
    ]
  )

  return admin
}

async function authenticateAdmin(username, password) {
  const admin = await findAdmin(username)

  if (!admin || !admin.active) {
    return null
  }

  const valid = await verifyPassword(
    password,
    admin.password_salt,
    admin.password_hash
  )

  if (!valid) {
    return null
  }

  const lastLoginAt = new Date().toISOString()

  await queryD1(
    'UPDATE admin_users SET last_login_at = ?1 WHERE id = ?2',
    [lastLoginAt, admin.id]
  )

  return publicAdmin({
    ...admin,
    last_login_at: lastLoginAt,
  })
}

async function listAdmins() {
  const { rows } = await queryD1(
    `SELECT id, username, role, active, created_at, created_by, last_login_at
       FROM admin_users
      ORDER BY created_at ASC`
  )

  return rows.map(publicAdmin)
}

async function initializeAdminStore({ bootstrapUsername, bootstrapPassword }) {
  if (!isD1Configured()) {
    console.warn(
      'Cloudflare D1 non configurato: accesso admin legacy attivo.'
    )
    return { mode: 'legacy' }
  }

  await queryD1(
    `CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      created_by TEXT,
      last_login_at TEXT
    )`
  )

  await queryD1(
    'CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username)'
  )

  const { rows } = await queryD1(
    'SELECT COUNT(*) AS total FROM admin_users'
  )
  const total = Number(rows[0]?.total || 0)

  if (total === 0) {
    await createAdmin({
      username: bootstrapUsername,
      password: bootstrapPassword,
      role: 'superadmin',
      createdBy: 'bootstrap',
      enforcePasswordPolicy: false,
    })

    console.log(
      `Super admin iniziale creato: ${normalizeUsername(bootstrapUsername)}`
    )
  }

  return { mode: 'd1' }
}

module.exports = {
  authenticateAdmin,
  createAdmin,
  initializeAdminStore,
  isD1Configured,
  listAdmins,
  normalizeUsername,
}
