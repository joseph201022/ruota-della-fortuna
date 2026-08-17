const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3001

// =====================================================
// CONFIGURAZIONE
// =====================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data')
const CODES_FILE = path.join(DATA_DIR, 'codes.json')

// =====================================================
// CONFIGURAZIONE OBBLIGATORIA
// =====================================================

if (!ADMIN_PASSWORD) {
  throw new Error(
    'ADMIN_PASSWORD mancante: crea un file .env partendo da .env.example.'
  )
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.disable('x-powered-by')
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || CLIENT_ORIGINS.includes(origin))
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use(express.json({ limit: '10kb' }))

// =====================================================
// CREAZIONE CARTELLA DATABASE
// =====================================================

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true,
  })
}

// =====================================================
// CARICAMENTO CODICI
// =====================================================

function loadCodes() {
  try {
    if (!fs.existsSync(CODES_FILE)) {
      fs.writeFileSync(
        CODES_FILE,
        JSON.stringify([], null, 2)
      )

      return new Map()
    }

    const file = fs.readFileSync(
      CODES_FILE,
      'utf8'
    )

    const parsed = JSON.parse(file)

    if (!Array.isArray(parsed)) {
      throw new Error('Il file dei codici non contiene un elenco valido.')
    }

    return new Map(
      parsed
        .filter((item) => item && typeof item.code === 'string')
        .map((item) => [
          item.code.toUpperCase(),
          { ...item, code: item.code.toUpperCase() },
        ])
    )
  } catch (error) {
    console.error(
      'Errore caricamento codici:',
      error
    )

    return new Map()
  }
}

function saveCodes() {
  let tempFile = ''

  try {
    tempFile = `${CODES_FILE}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(
      tempFile,
      JSON.stringify(Array.from(codes.values()), null, 2),
      'utf8'
    )
    fs.renameSync(tempFile, CODES_FILE)
    return true
  } catch (error) {
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }

    console.error(
      'Errore salvataggio codici:',
      error
    )

    return false
  }
}

const codes = loadCodes()

// =====================================================
// SESSIONI ADMIN
// =====================================================

const adminTokens = new Map()
const loginAttempts = new Map()

function generateAdminToken() {
  return crypto.randomBytes(32).toString('hex')
}

function hasValidAdminPassword(password) {
  const expected = Buffer.from(ADMIN_PASSWORD)
  const received = Buffer.from(password)

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  )
}

function loginRateLimiter(req, res, next) {
  const now = Date.now()
  const key = req.ip
  const attempt = loginAttempts.get(key)

  if (!attempt || now >= attempt.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return next()
  }

  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({
      success: false,
      message: 'Troppi tentativi. Riprova più tardi.',
    })
  }

  attempt.count += 1
  return next()
}

function requireAdmin(req, res, next) {
  const authorization =
    req.headers.authorization || ''

  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Accesso amministratore richiesto.',
    })
  }

  const token =
    authorization.substring(7)

  const expiresAt = adminTokens.get(token)

  if (!expiresAt || expiresAt <= Date.now()) {
    adminTokens.delete(token)

    return res.status(401).json({
      success: false,
      message: 'Sessione admin non valida o scaduta.',
    })
  }

  next()
}

// =====================================================
// RUOTE DELLA FORTUNA
// =====================================================

const wheels = {
  '10000': {
    name: 'RUOTA $10.000',
    prizes: [
      {
        id: 'nothing',
        label: 'Niente',
        emoji: '❌',
        probability: 28.17,
      },
      {
        id: 'kit-2',
        label: '2 Kit Riparazione',
        emoji: '🧰',
        probability: 14.17,
      },
      {
        id: 'kit-4',
        label: '4 Kit Riparazione',
        emoji: '🧰',
        probability: 13.33,
      },
      {
        id: 'kit-6',
        label: '6 Kit Riparazione',
        emoji: '🧰',
        probability: 11.67,
      },
      {
        id: 'kit-8',
        label: '8 Kit Riparazione',
        emoji: '🧰',
        probability: 10.00,
      },
      {
        id: 'kit-12',
        label: '12 Kit Riparazione',
        emoji: '🧰',
        probability: 8.33,
      },
      {
        id: 'free-spin',
        label: 'Secondo giro gratis',
        emoji: '🔄',
        probability: 8.33,
      },
      {
        id: 'kit-16',
        label: '16 Kit Riparazione',
        emoji: '🧰',
        probability: 2.50,
      },
      {
        id: 'ticket-50000',
        label: 'Biglietto Ruota $50.000',
        emoji: '🎟️',
        probability: 2.50,
      },
      {
        id: 'picador',
        label: 'Auto - CHEVAL PICADOR 205',
        emoji: '🚗',
        probability: 1.00,
      },
    ],
  },

  '50000': {
    name: 'RUOTA $50.000',
    prizes: [
      {
        id: 'nothing',
        label: 'Niente',
        emoji: '❌',
        probability: 25.09,
      },
      {
        id: 'kit-6',
        label: '6 Kit Riparazione',
        emoji: '🧰',
        probability: 14.78,
      },
      {
        id: 'kit-10',
        label: '10 Kit Riparazione',
        emoji: '🧰',
        probability: 13.91,
      },
      {
        id: 'kit-12',
        label: '12 Kit Riparazione',
        emoji: '🧰',
        probability: 12.17,
      },
      {
        id: 'kit-16',
        label: '16 Kit Riparazione',
        emoji: '🧰',
        probability: 10.43,
      },
      {
        id: 'kit-24',
        label: '24 Kit Riparazione',
        emoji: '🧰',
        probability: 8.70,
      },
      {
        id: 'free-spin',
        label: 'Secondo giro gratis',
        emoji: '🔄',
        probability: 8.70,
      },
      {
        id: 'kit-32',
        label: '32 Kit Riparazione',
        emoji: '🧰',
        probability: 2.61,
      },
      {
        id: 'ticket-150000',
        label: 'Biglietto Ruota $150.000',
        emoji: '🎟️',
        probability: 2.61,
      },
      {
        id: 'asterope-rs',
        label: 'Auto - KARIN ASTEROPE RS',
        emoji: '🚗',
        probability: 1.00,
      },
    ],
  },

  '150000': {
    name: 'RUOTA $150.000',
    prizes: [
      {
        id: 'nothing',
        label: 'Niente',
        emoji: '❌',
        probability: 21.72,
      },
      {
        id: 'kit-12',
        label: '12 Kit Riparazione',
        emoji: '🧰',
        probability: 15.45,
      },
      {
        id: 'kit-20',
        label: '20 Kit Riparazione',
        emoji: '🧰',
        probability: 14.55,
      },
      {
        id: 'kit-28',
        label: '28 Kit Riparazione',
        emoji: '🧰',
        probability: 12.73,
      },
      {
        id: 'kit-40',
        label: '40 Kit Riparazione',
        emoji: '🧰',
        probability: 10.91,
      },
      {
        id: 'kit-60',
        label: '60 Kit Riparazione',
        emoji: '🧰',
        probability: 9.09,
      },
      {
        id: 'free-spin',
        label: 'Secondo giro gratis',
        emoji: '🔄',
        probability: 9.09,
      },
      {
        id: 'kit-80',
        label: '80 Kit Riparazione',
        emoji: '🧰',
        probability: 2.73,
      },
      {
        id: 'ticket-250000',
        label: 'Biglietto Ruota $250.000',
        emoji: '🎟️',
        probability: 2.73,
      },
      {
        id: 'rapid-gt',
        label: 'Auto - DEWBAUCHEE RAPID GT VANTAGE',
        emoji: '🏎️',
        probability: 1.00,
      },
    ],
  },

  '250000': {
    name: 'RUOTA $250.000 - JACKPOT',
    prizes: [
      {
        id: 'nothing',
        label: 'Niente',
        emoji: '❌',
        probability: 18.06,
      },
      {
        id: 'kit-24',
        label: '24 Kit Riparazione',
        emoji: '🧰',
        probability: 16.19,
      },
      {
        id: 'kit-40',
        label: '40 Kit Riparazione',
        emoji: '🧰',
        probability: 15.24,
      },
      {
        id: 'kit-60',
        label: '60 Kit Riparazione',
        emoji: '🧰',
        probability: 13.33,
      },
      {
        id: 'kit-80',
        label: '80 Kit Riparazione',
        emoji: '🧰',
        probability: 11.43,
      },
      {
        id: 'kit-120',
        label: '120 Kit Riparazione',
        emoji: '🧰',
        probability: 9.52,
      },
      {
        id: 'free-spin',
        label: 'Secondo giro gratis',
        emoji: '🔄',
        probability: 12.38,
      },
      {
        id: 'kit-160',
        label: '160 Kit Riparazione',
        emoji: '🧰',
        probability: 1.90,
      },
      {
        id: 'kit-200',
        label: '200 Kit Riparazione',
        emoji: '🧰',
        probability: 0.95,
      },
      {
        id: 'american-garage',
        label: 'American Garage (~$1.300.000)',
        emoji: '🇺🇸',
        probability: 1.00,
      },
    ],
  },
}

// =====================================================
// GENERAZIONE CODICI
// =====================================================

function generateCode() {
  const characters =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  return Array.from(
    { length: 4 },
    () => characters[crypto.randomInt(characters.length)]
  ).join('')
}

// =====================================================
// ESTRAZIONE PREMIO
// =====================================================

function drawPrize(prizes) {
  const totalProbability = prizes.reduce(
    (total, prize) => total + Math.max(0, Number(prize.probability) || 0),
    0
  )

  if (!totalProbability) {
    throw new Error('Le probabilità della ruota non sono valide.')
  }

  const random = Math.random() * totalProbability

  let accumulated = 0

  for (const prize of prizes) {
    accumulated += Math.max(0, Number(prize.probability) || 0)

    if (random < accumulated) {
      return prize
    }
  }

  return prizes[prizes.length - 1]
}

// =====================================================
// STATUS
// =====================================================

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message:
      'LSC Ruota della Fortuna online',
    codes: codes.size,
  })
})

// =====================================================
// LOGIN ADMIN
// =====================================================

app.post('/api/admin/login', loginRateLimiter, (req, res) => {
  const password =
    String(req.body.password || '')

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Inserisci la password.',
    })
  }

  if (!hasValidAdminPassword(password)) {
    return res.status(401).json({
      success: false,
      message: 'Password non corretta.',
    })
  }

  const token = generateAdminToken()

  adminTokens.set(
    token,
    Date.now() + ADMIN_SESSION_DURATION_MS
  )
  loginAttempts.delete(req.ip)

  res.json({
    success: true,
    token,
  })
})

// =====================================================
// LOGOUT ADMIN
// =====================================================

app.post(
  '/api/admin/logout',
  requireAdmin,
  (req, res) => {
    const token =
      req.headers.authorization.substring(7)

    adminTokens.delete(token)

    res.json({
      success: true,
    })
  }
)

// =====================================================
// GENERA CODICI
// =====================================================

app.post(
  '/api/codes',
  requireAdmin,
  (req, res) => {
    const {
      wheel,
      quantity,
    } = req.body

    if (!wheel || !wheels[wheel]) {
      return res.status(400).json({
        success: false,
        message: 'Ruota non valida.',
      })
    }

    const amount =
      quantity === undefined
        ? 1
        : Number(quantity)

    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Inserisci una quantità intera compresa tra 1 e 100.',
      })
    }

    const generated = []

    for (let i = 0; i < amount; i++) {
      let code = generateCode()

      while (codes.has(code)) {
        code = generateCode()
      }

      const newCode = {
        code,
        wheel,
        wheelName: wheels[wheel].name,
        used: false,
        prize: null,
        createdAt:
          new Date().toISOString(),
        usedAt: null,
      }

      codes.set(code, newCode)
      generated.push(newCode)
    }

    if (!saveCodes()) {
      generated.forEach(({ code }) => codes.delete(code))

      return res.status(500).json({
        success: false,
        message: 'Impossibile salvare i codici generati.',
      })
    }

    res.json({
      success: true,
      codes: generated,
    })
  }
)

// =====================================================
// VERIFICA CODICE
// =====================================================

app.post(
  '/api/codes/verify',
  (req, res) => {
    const code =
      String(req.body.code || '')
        .trim()
        .toUpperCase()

    if (!code) {
      return res.status(400).json({
        success: false,
        message:
          'Inserisci un codice.',
      })
    }

    const codeData =
      codes.get(code)

    if (!codeData) {
      return res.status(404).json({
        success: false,
        message:
          'Codice non valido.',
      })
    }

    if (codeData.used) {
      return res.status(409).json({
        success: false,
        message:
          'Questo codice è già stato utilizzato.',
      })
    }

    res.json({
      success: true,
      code: codeData.code,
      wheel: codeData.wheel,
      wheelName:
        codeData.wheelName,
    })
  }
)

// =====================================================
// GIRA LA RUOTA
// =====================================================

app.post(
  '/api/codes/spin',
  (req, res) => {
    const code =
      String(req.body.code || '')
        .trim()
        .toUpperCase()

    const codeData =
      codes.get(code)

    if (!codeData) {
      return res.status(404).json({
        success: false,
        message:
          'Codice non valido.',
      })
    }

    if (codeData.used) {
      return res.status(409).json({
        success: false,
        message:
          'Questo codice è già stato utilizzato.',
      })
    }

    const wheel =
      wheels[codeData.wheel]

    if (!wheel) {
      return res.status(500).json({
        success: false,
        message:
          'Ruota non trovata.',
      })
    }

    let prize

    try {
      prize = drawPrize(wheel.prizes)
    } catch (error) {
      console.error('Errore estrazione premio:', error)

      return res.status(500).json({
        success: false,
        message: 'Configurazione della ruota non valida.',
      })
    }

    const previousState = {
      used: codeData.used,
      prize: codeData.prize,
      usedAt: codeData.usedAt,
    }

    codeData.used = true
    codeData.prize = prize
    codeData.usedAt =
      new Date().toISOString()

    codes.set(code, codeData)

    if (!saveCodes()) {
      Object.assign(codeData, previousState)

      return res.status(500).json({
        success: false,
        message: 'Impossibile registrare il risultato del giro.',
      })
    }

    res.json({
      success: true,
      code: codeData.code,
      wheel: wheel.name,
      prize,
    })
  }
)

// =====================================================
// LISTA CODICI ADMIN
// =====================================================

app.get(
  '/api/codes',
  requireAdmin,
  (req, res) => {
    res.json({
      success: true,
      codes:
        Array.from(
          codes.values()
        ).reverse(),
    })
  }
)

// =====================================================
// RUOTE
// =====================================================

app.get(
  '/api/wheels',
  (req, res) => {
    const result =
      Object.entries(
        wheels
      ).map(
        ([id, wheel]) => ({
          id,
          name: wheel.name,
          prizes:
            wheel.prizes,
        })
      )

    res.json({
      success: true,
      wheels: result,
    })
  }
)

// =====================================================
// AVVIO SERVER
// =====================================================

app.listen(
  PORT,
  () => {
    console.log('')
    console.log(
      '======================================'
    )
    console.log(
      '       LSC RUOTA DELLA FORTUNA'
    )
    console.log(
      '======================================'
    )
    console.log(
      `       Server: http://localhost:${PORT}`
    )
    console.log(
      '       Admin: /admin'
    )
    console.log(
      '======================================'
    )
    console.log('')
  }
)
