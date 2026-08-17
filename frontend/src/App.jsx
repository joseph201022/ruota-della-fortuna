import React, { useEffect, useRef, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SPIN_DURATION_MS = 6500
const WHEEL_COLORS = [
  '#142d53',
  '#3478d0',
  '#162f55',
  '#4089e0',
  '#17335d',
  '#2f6fc2',
  '#122b4d',
  '#3b80d5',
  '#173258',
  '#316db8',
]

async function readJson(response) {
  const body = await response.text()

  if (!body) {
    return {}
  }

  try {
    return JSON.parse(body)
  } catch {
    return {}
  }
}

function getWheelGeometry(prizes = []) {
  const sectorAngle = prizes.length ? 360 / prizes.length : 0

  return prizes.map((prize, index) => {
    const startAngle = index * sectorAngle

    return {
      prize,
      startAngle,
      sectorAngle,
      centerAngle: startAngle + sectorAngle / 2,
    }
  })
}

function getCompactPrizeLabel(label = '') {
  return label
    .replace(/^Auto\s*-\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/Biglietto Ruota/gi, 'Ruota')
    .replace(/Kit Riparazione/gi, 'Kit')
    .replace(/Secondo giro gratis/gi, 'Giro gratis')
}

function getWheelStyles(geometry) {
  const backgroundStops = geometry.map(
    ({ startAngle, sectorAngle }, index) => {
      const endAngle = startAngle + sectorAngle
      const color = WHEEL_COLORS[index % WHEEL_COLORS.length]

      return `${color} ${startAngle}deg ${endAngle}deg`
    }
  )

  const separatorStops = geometry.map(
    ({ startAngle, sectorAngle }) => {
      const separatorEnd = Math.min(
        startAngle + 1,
        startAngle + sectorAngle
      )
      const endAngle = startAngle + sectorAngle

      return `rgba(255, 255, 255, 0.55) ${startAngle}deg ${separatorEnd}deg, transparent ${separatorEnd}deg ${endAngle}deg`
    }
  )

  return {
    '--wheel-background': `conic-gradient(from 0deg, ${backgroundStops.join(', ')})`,
    '--wheel-separators': `conic-gradient(from 0deg, ${separatorStops.join(', ')})`,
  }
}

// =====================================================
// APP PRINCIPALE
// =====================================================

function App() {
  const isAdminPage =
    window.location.pathname.toLowerCase() === '/admin'

  useEffect(() => {
    const robotsMeta = document.querySelector('meta[name="robots"]')

    if (isAdminPage) {
      document.title = 'Amministrazione | LSC Ruota'
      robotsMeta?.setAttribute('content', 'noindex, nofollow')
    } else {
      document.title = 'LSC Ruota della Fortuna | Los Santos Custom'
      robotsMeta?.setAttribute('content', 'index, follow')
    }
  }, [isAdminPage])

  if (isAdminPage) {
    return <AdminPanel />
  }

  return <WheelApp />
}

// =====================================================
// RUOTA CLIENTE
// =====================================================

function WheelApp() {
  const [code, setCode] = useState('')
  const [gameId, setGameId] = useState('')
  const [screen, setScreen] = useState('welcome')
  const [wheel, setWheel] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const spinTimeoutRef = useRef(null)
  const wheelGeometry = wheel
    ? getWheelGeometry(wheel.prizes)
    : []
  const wheelStyles = getWheelStyles(wheelGeometry)

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current)
      }
    }
  }, [])

  // ===================================================
  // VERIFICA CODICE
  // ===================================================

  const verifyCode = async (e) => {
    e.preventDefault()

    const cleanCode = code.trim().toUpperCase()

    if (!/^[A-Z0-9]{4}$/.test(cleanCode)) {
      setError('Inserisci un codice alfanumerico di 4 caratteri.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `${API_URL}/api/codes/verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: cleanCode,
          }),
        }
      )

      const data = await readJson(response)

      if (!response.ok) {
        setError(data.message || 'Codice non valido.')
        return
      }

      const wheelsResponse = await fetch(
        `${API_URL}/api/wheels`
      )

      const wheelsData = await readJson(wheelsResponse)

      if (!wheelsResponse.ok || !Array.isArray(wheelsData.wheels)) {
        setError(
          wheelsData.message || 'Impossibile caricare le ruote.'
        )
        return
      }

      const selectedWheel = wheelsData.wheels.find(
        (item) => String(item.id) === String(data.wheel)
      )

      if (!selectedWheel) {
        setError('Ruota non trovata.')
        return
      }

      setCode(data.code || cleanCode)
      setWheel(selectedWheel)
      setGameId('')
      setResult(null)
      setRotation(0)
      setScreen('player-id')
    } catch (error) {
      console.error(error)

      setError('Impossibile collegarsi al server.')
    } finally {
      setLoading(false)
    }
  }

  const confirmGameId = (e) => {
    e.preventDefault()

    const cleanGameId = gameId.trim()

    if (!cleanGameId) {
      setError('Inserisci il tuo ID In Game per continuare.')
      return
    }

    if (cleanGameId.length > 64) {
      setError('L\'ID In Game non può superare 64 caratteri.')
      return
    }

    setGameId(cleanGameId)
    setError('')
    setScreen('wheel')
  }

  // ===================================================
  // GIRA RUOTA
  // ===================================================

  const spinWheel = async () => {
    if (spinning || !wheel || !gameId) {
      return
    }

    setSpinning(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch(
        `${API_URL}/api/codes/spin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            gameId,
          }),
        }
      )

      const data = await readJson(response)

      if (!response.ok) {
        setError(
          data.message || 'Impossibile girare la ruota.'
        )

        setSpinning(false)
        return
      }

      const winningIndex = wheelGeometry.findIndex(
        ({ prize }) => String(prize.id) === String(data.prize?.id)
      )

      if (winningIndex === -1) {
        setError('Premio non trovato.')

        setSpinning(false)
        return
      }

      const targetAngle =
        wheelGeometry[winningIndex].centerAngle

      const extraSpins = 7 * 360

      const currentRotation = rotation % 360

      const correction =
        360 -
        targetAngle -
        currentRotation

      const finalRotation =
        rotation +
        extraSpins +
        correction

      setRotation(finalRotation)

      spinTimeoutRef.current = setTimeout(() => {
        setResult(data.prize)
        setSpinning(false)
        setScreen('result')
      }, SPIN_DURATION_MS)
    } catch (error) {
      console.error(error)

      setError(
        'Errore di connessione con il server.'
      )

      setSpinning(false)
    }
  }

  // ===================================================
  // RESET
  // ===================================================

  const resetPage = () => {
    setCode('')
    setGameId('')
    setWheel(null)
    setResult(null)
    setError('')
    setRotation(0)
    setScreen('welcome')
  }

  // ===================================================
  // RENDER
  // ===================================================

  return (
    <main className="app">

      <div className="background-glow glow-one" />
      <div className="background-glow glow-two" />

      {/* =============================================
          WELCOME
      ============================================= */}

      {screen === 'welcome' && (
        <section className="welcome-card">

          <div className="top-badge">
            <span className="badge-dot" />
            LSC • SISTEMA RUOTA DELLA FORTUNA
          </div>

          <img
            className="brand-logo welcome-brand-logo"
            src="/lsc-logo.png"
            alt="Los Santos Custom"
          />

          <h1>
            Benvenuto a LSC
            <span>
              Ruota della Fortuna
            </span>
          </h1>

          <p className="description">
            Inserisci il codice che ti è
            stato fornito per accedere
            alla ruota e scoprire la tua
            ricompensa.
          </p>

          <form
            onSubmit={verifyCode}
            className="code-form"
          >

            <label htmlFor="code">
              CODICE DI ACCESSO
            </label>

            <div className="input-wrapper">

              <span className="input-icon">
                🎟️
              </span>

              <input
                id="code"
                type="text"
                placeholder="A7K2"
                value={code}
                onChange={(e) => {
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 4)
                  )

                  setError('')
                }}
                autoComplete="off"
                spellCheck="false"
                inputMode="text"
                maxLength={4}
                disabled={loading}
              />

            </div>

            <button
              type="submit"
              className="access-button"
              disabled={loading}
            >
              {loading
                ? 'VERIFICA IN CORSO...'
                : 'ACCEDI ALLA RUOTA'}

              {!loading && (
                <span className="arrow">
                  →
                </span>
              )}
            </button>

          </form>

          {error && (
            <div className="error-message">
              <span>⚠️</span>
              {error}
            </div>
          )}

          <div className="security-info">

            <span className="lock-icon">
              🔒
            </span>

            <div>
              <strong>
                Codice personale
              </strong>

              <p>
                Ogni codice può essere
                utilizzato una sola volta.
              </p>
            </div>

          </div>

        </section>
      )}

      {/* =============================================
          ID IN GAME
      ============================================= */}

      {screen === 'player-id' && (
        <section className="welcome-card">

          <div className="top-badge">
            <span className="badge-dot" />
            CODICE VERIFICATO
          </div>

          <img
            className="brand-logo welcome-brand-logo"
            src="/lsc-logo.png"
            alt="Los Santos Custom"
          />

          <h1>
            Inserisci Il Tuo
            <span>
              Id In Game
            </span>
          </h1>

          <p className="description">
            L'ID verrà associato al risultato della ruota.
          </p>

          <form
            onSubmit={confirmGameId}
            className="code-form"
          >

            <label htmlFor="game-id">
              INSERISCI IL TUO ID IN GAME
            </label>

            <div className="input-wrapper">

              <span className="input-icon">
                🎮
              </span>

              <input
                id="game-id"
                type="text"
                placeholder="Il tuo ID In Game"
                value={gameId}
                onChange={(e) => {
                  setGameId(e.target.value.slice(0, 64))
                  setError('')
                }}
                autoComplete="off"
                spellCheck="false"
                maxLength={64}
                autoFocus
              />

            </div>

            <button
              type="submit"
              className="access-button"
            >
              CONTINUA ALLA RUOTA
              <span className="arrow">
                →
              </span>
            </button>

          </form>

          {error && (
            <div className="error-message">
              <span>⚠️</span>
              {error}
            </div>
          )}

        </section>
      )}

      {/* =============================================
          RUOTA
      ============================================= */}

      {screen === 'wheel' &&
        wheel && (
          <section className="wheel-page">

            <div className="wheel-header">

              <img
                className="brand-logo wheel-brand-logo"
                src="/lsc-logo.png"
                alt="Los Santos Custom"
              />

              <div className="top-badge">
                <span className="badge-dot" />
                CODICE VERIFICATO
              </div>

              <h2>
                {wheel.name}
              </h2>

              <p>
                Premi il pulsante e scopri
                la tua ricompensa.
              </p>

            </div>

            <div className="wheel-area">

              <div className="pointer">
                <div className="pointer-shadow" />
              </div>

              <div
                className="wheel"
                style={{
                  transform: `rotate(${rotation}deg)`,
                }}
              >

                <div
                  className="wheel-inner"
                  style={wheelStyles}
                >

                  {wheelGeometry.map(
                    ({ prize, centerAngle }) => {
                      return (
                        <div
                          key={prize.id}
                          className="wheel-label"
                          style={{
                            transform: `
                              translate(-50%, -50%)
                              rotate(${centerAngle}deg)
                              translateY(var(--wheel-label-offset))
                              rotate(${-centerAngle}deg)
                            `,
                          }}
                        >

                          <span>
                            {prize.emoji}
                          </span>

                          <strong title={prize.label}>
                            {getCompactPrizeLabel(prize.label)}
                          </strong>

                        </div>
                      )
                    }
                  )}

                  <div className="wheel-center">

                    <div className="center-ring">
                      🎡
                    </div>

                  </div>

                </div>

              </div>

            </div>

            <div className="wheel-actions">

              <button
                className="big-spin-button"
                onClick={spinWheel}
                disabled={spinning}
              >

                {spinning ? (
                  <>
                    <span className="button-spinner" />
                    LA RUOTA STA GIRANDO...
                  </>
                ) : (
                  <>
                    🎡 GIRA LA RUOTA
                  </>
                )}

              </button>

              <div className="code-display">
                CODICE:
                <strong>
                  {code}
                </strong>
              </div>

              <div className="code-display">
                ID IN GAME:
                <strong>
                  {gameId}
                </strong>
              </div>

            </div>

            {error && (
              <div className="error-message wheel-error">
                <span>⚠️</span>
                {error}
              </div>
            )}

          </section>
        )}

      {/* =============================================
          RISULTATO
      ============================================= */}

      {screen === 'result' &&
        result && (
          <section className="result-card">

            <img
              className="brand-logo result-brand-logo"
              src="/lsc-logo.png"
              alt="Los Santos Custom"
            />

            <div className="result-badge">
              🎉 RISULTATO DELLA RUOTA
            </div>

            <div className="result-icon">
              {result.emoji}
            </div>

            <p className="result-small-title">
              HAI VINTO
            </p>

            <h1 className="result-title">
              {result.label}
            </h1>

            <div className="result-line" />

            <div className="result-code">

              <span>
                CODICE UTILIZZATO
              </span>

              <strong>
                {code}
              </strong>

            </div>

            <div className="result-code">

              <span>
                ID IN GAME
              </span>

              <strong>
                {gameId}
              </strong>

            </div>

            <div className="result-warning">
              🔒 Questo codice è stato
              utilizzato e non può essere
              riutilizzato.
            </div>

            <button
              className="back-button"
              onClick={resetPage}
            >
              TORNA ALLA PAGINA INIZIALE
            </button>

          </section>
        )}

      <footer className="global-footer">

        <span>
          LOS SANTOS CUSTOM
        </span>

        <span className="footer-separator">
          •
        </span>

        <span>
          RUOTA DELLA FORTUNA
        </span>

      </footer>

    </main>
  )
}

// =====================================================
// ADMIN PANEL
// =====================================================

function AdminPanel() {

  const [token, setToken] =
    useState(
      localStorage.getItem(
        'lsc_admin_token'
      ) || ''
    )

  const [password, setPassword] =
    useState('')

  const [loginError, setLoginError] =
    useState('')

  const [loggingIn, setLoggingIn] =
    useState(false)

  const [wheels, setWheels] =
    useState([])

  const [selectedWheel, setSelectedWheel] =
    useState('')

  const [quantity, setQuantity] =
    useState(1)

  const [codes, setCodes] =
    useState([])

  const [loadingCodes, setLoadingCodes] =
    useState(false)

  const [generating, setGenerating] =
    useState(false)

  const [adminError, setAdminError] =
    useState('')

  const [generatedCodes, setGeneratedCodes] =
    useState([])

  const [search, setSearch] =
    useState('')

  // ===================================================
  // CARICA RUOTE
  // ===================================================

  useEffect(() => {
    let cancelled = false

    const loadWheels = async () => {
      try {
        const response = await fetch(`${API_URL}/api/wheels`)
        const data = await readJson(response)

        if (!response.ok || !Array.isArray(data.wheels)) {
          throw new Error(
            data.message || 'Impossibile caricare le ruote.'
          )
        }

        if (cancelled) return

        setWheels(data.wheels)
        setSelectedWheel((currentWheel) => {
          const currentWheelExists = data.wheels.some(
            (wheel) => String(wheel.id) === String(currentWheel)
          )

          return currentWheelExists
            ? currentWheel
            : String(data.wheels[0]?.id || '')
        })
      } catch (error) {
        console.error(error)

        if (!cancelled) {
          setAdminError(
            error.message || 'Impossibile caricare le ruote.'
          )
        }
      }
    }

    loadWheels()

    return () => {
      cancelled = true
    }

  }, [token])

  // ===================================================
  // CARICA CODICI
  // ===================================================

  useEffect(() => {

    if (token) {
      loadCodes()
    }

  }, [token])

  // ===================================================
  // LOGIN
  // ===================================================

  const login = async (e) => {

    e.preventDefault()

    if (!password.trim()) {

      setLoginError(
        'Inserisci la password.'
      )

      return
    }

    setLoggingIn(true)
    setLoginError('')

    try {

      const response =
        await fetch(
          `${API_URL}/api/admin/login`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              password,
            }),
          }
        )

      const data =
        await readJson(response)

      if (!response.ok) {

        setLoginError(
          data.message ||
            'Password non corretta.'
        )

        return
      }

      if (!data.token) {
        setLoginError('Risposta del server non valida.')
        return
      }

      localStorage.setItem(
        'lsc_admin_token',
        data.token
      )

      setToken(data.token)
      setPassword('')

    } catch (error) {

      console.error(error)

      setLoginError(
        'Impossibile collegarsi al server.'
      )

    } finally {

      setLoggingIn(false)

    }
  }

  // ===================================================
  // CARICA CODICI
  // ===================================================

  const loadCodes = async () => {

    if (!token) return

    setLoadingCodes(true)
    setAdminError('')

    try {

      const response =
        await fetch(
          `${API_URL}/api/codes`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        )

      const data =
        await readJson(response)

      if (
        response.status ===
        401
      ) {

        logout()
        return
      }

      if (!response.ok) {

        setAdminError(
          data.message ||
            'Errore caricamento codici.'
        )

        return
      }

      setCodes(
        data.codes || []
      )

    } catch (error) {

      console.error(error)

      setAdminError(
        'Errore di connessione al server.'
      )

    } finally {

      setLoadingCodes(false)

    }
  }

  // ===================================================
  // GENERA CODICI
  // ===================================================

  const generateCodes = async () => {

    const amount =
      Number(quantity)

    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 100
    ) {

      setAdminError(
        'Inserisci una quantità compresa tra 1 e 100.'
      )

      return
    }

    if (!selectedWheel) {
      setAdminError('Seleziona una ruota prima di generare i codici.')
      return
    }

    setGenerating(true)
    setAdminError('')
    setGeneratedCodes([])

    try {

      const response =
        await fetch(
          `${API_URL}/api/codes`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              Authorization:
                `Bearer ${token}`,
            },
            body: JSON.stringify({
              wheel:
                selectedWheel,
              quantity:
                amount,
            }),
          }
        )

      const data =
        await readJson(response)

      if (
        response.status ===
        401
      ) {

        logout()
        return
      }

      if (!response.ok) {

        setAdminError(
          data.message ||
            'Errore nella generazione.'
        )

        return
      }

      setGeneratedCodes(
        data.codes || []
      )

      await loadCodes()

    } catch (error) {

      console.error(error)

      setAdminError(
        'Errore di connessione al server.'
      )

    } finally {

      setGenerating(false)

    }
  }

  // ===================================================
  // LOGOUT
  // ===================================================

  const logout = async () => {

    try {

      await fetch(
        `${API_URL}/api/admin/logout`,
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        }
      )

    } catch {}

    localStorage.removeItem(
      'lsc_admin_token'
    )

    setToken('')
    setCodes([])
  }

  // ===================================================
  // COPIA CODICE
  // ===================================================

  const copyCode = async (code) => {

    try {

      await navigator.clipboard.writeText(
        code
      )

    } catch (error) {

      console.error(
        'Impossibile copiare il codice.',
        error
      )

    }
  }

  // ===================================================
  // COPIA TUTTI
  // ===================================================

  const copyAllGenerated =
    async () => {

      const all =
        generatedCodes
          .map(
            (item) =>
              item.code
          )
          .join('\n')

      try {

        await navigator.clipboard.writeText(
          all
        )

      } catch (error) {

        console.error(error)

      }
    }

  // ===================================================
  // DATA
  // ===================================================

  const formatDate = (date) => {

    if (!date) {
      return '—'
    }

    return new Date(
      date
    ).toLocaleString(
      'it-IT'
    )
  }

  // ===================================================
  // LOGIN SCREEN
  // ===================================================

  if (!token) {

    return (
      <main className="admin-page">

        <div className="admin-glow admin-glow-one" />
        <div className="admin-glow admin-glow-two" />

        <section className="admin-login">

          <img
            className="brand-logo admin-brand-logo"
            src="/lsc-logo.png"
            alt="Los Santos Custom"
          />

          <div className="admin-badge">
            AREA RISERVATA
          </div>

          <h1>
            Pannello
            <span>
              Amministratore
            </span>
          </h1>

          <p>
            Accedi per gestire le
            ruote, generare i codici
            e controllare i risultati.
          </p>

          <form
            onSubmit={login}
          >

            <label>
              PASSWORD ADMIN
            </label>

            <input
              type="password"
              placeholder="Inserisci la password"
              value={password}
              onChange={(e) => {

                setPassword(
                  e.target.value
                )

                setLoginError('')

              }}
            />

            {loginError && (
              <div className="admin-login-error">
                ⚠️ {loginError}
              </div>
            )}

            <button
              className="admin-login-button"
              disabled={loggingIn}
            >
              {loggingIn
                ? 'ACCESSO...'
                : 'ACCEDI AL PANNELLO'}
            </button>

          </form>

          <div className="admin-login-footer">
            LOS SANTOS CUSTOM
          </div>

        </section>

      </main>
    )
  }

  // ===================================================
  // STATISTICHE
  // ===================================================

  const totalCodes =
    codes.length

  const usedCodes =
    codes.filter(
      (item) =>
        item.used
    ).length

  const availableCodes =
    totalCodes -
    usedCodes

  // ===================================================
  // RICERCA
  // ===================================================

  const filteredCodes =
    codes.filter(
      (item) => {

        const text =
          `${item.code} ${item.wheelName} ${item.prize?.label || ''}`
            .toLowerCase()

        return text.includes(
          search.toLowerCase()
        )
      }
    )

  // ===================================================
  // DASHBOARD
  // ===================================================

  return (
    <main className="admin-page">

      <div className="admin-glow admin-glow-one" />
      <div className="admin-glow admin-glow-two" />

      <section className="admin-dashboard">

        {/* HEADER */}

        <header className="admin-header">

          <div className="admin-heading">

            <img
              className="brand-logo admin-dashboard-logo"
              src="/lsc-logo.png"
              alt="Los Santos Custom"
            />

            <div className="admin-badge">
              CONTROL PANEL
            </div>

            <h1>
              Ruota della
              <span>
                Fortuna
              </span>
            </h1>

            <p>
              Gestione codici e
              risultati delle
              ruote LSC.
            </p>

          </div>

          <button
            className="admin-logout"
            onClick={logout}
          >
            🔒 ESCI
          </button>

        </header>

        {/* STATS */}

        <section className="stats-grid">

          <div className="stat-card">

            <div className="stat-icon blue">
              🎟️
            </div>

            <div>

              <span>
                CODICI TOTALI
              </span>

              <strong>
                {totalCodes}
              </strong>

            </div>

          </div>

          <div className="stat-card">

            <div className="stat-icon green">
              🟢
            </div>

            <div>

              <span>
                DISPONIBILI
              </span>

              <strong>
                {availableCodes}
              </strong>

            </div>

          </div>

          <div className="stat-card">

            <div className="stat-icon red">
              🎯
            </div>

            <div>

              <span>
                UTILIZZATI
              </span>

              <strong>
                {usedCodes}
              </strong>

            </div>

          </div>

        </section>

        {/* GENERATORE */}

        <section className="admin-generator">

          <div className="section-title">

            <div>

              <span className="section-kicker">
                GENERATORE
              </span>

              <h2>
                Genera nuovi codici
              </h2>

              <p>
                Scegli la ruota e la
                quantità di codici
                da creare.
              </p>

            </div>

            <div className="generator-icon">
              🎟️
            </div>

          </div>

          <div className="generator-form">

            <div className="admin-field">

              <label>
                RUOTA
              </label>

              <select
                value={selectedWheel}
                disabled={wheels.length === 0}
                onChange={(e) =>
                  setSelectedWheel(
                    e.target.value
                  )
                }
              >

                {wheels.map(
                  (wheel) => (

                    <option
                      key={wheel.id}
                      value={wheel.id}
                    >
                      {wheel.name}
                    </option>

                  )
                )}

              </select>

            </div>

            <div className="admin-field quantity-field">

              <label>
                QUANTITÀ
              </label>

              <input
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    e.target.value
                  )
                }
              />

            </div>

            <button
              className="generate-button"
              onClick={generateCodes}
              disabled={
                generating ||
                !selectedWheel ||
                wheels.length === 0
              }
            >
              {generating
                ? 'GENERAZIONE...'
                : '＋ GENERA CODICI'}
            </button>

          </div>

          {adminError && (
            <div className="admin-error">
              ⚠️ {adminError}
            </div>
          )}

          {/* CODICI APPENA GENERATI */}

          {generatedCodes.length > 0 && (

            <div className="generated-result">

              <div className="generated-header">

                <div>

                  <span>
                    GENERAZIONE COMPLETATA
                  </span>

                  <strong>

                    {generatedCodes.length}{' '}

                    {generatedCodes.length === 1
                      ? 'codice creato'
                      : 'codici creati'}

                  </strong>

                </div>

                <button
                  onClick={
                    copyAllGenerated
                  }
                >
                  📋 COPIA TUTTI
                </button>

              </div>

              <div className="generated-codes">

                {generatedCodes.map(
                  (item) => (

                    <div
                      className="generated-code"
                      key={item.code}
                    >

                      <strong>
                        {item.code}
                      </strong>

                      <button
                        onClick={() =>
                          copyCode(
                            item.code
                          )
                        }
                      >
                        COPIA
                      </button>

                    </div>

                  )
                )}

              </div>

            </div>

          )}

        </section>

        {/* DATABASE */}

        <section className="codes-section">

          <div className="codes-header">

            <div>

              <span className="section-kicker">
                DATABASE
              </span>

              <h2>
                Codici generati
              </h2>

            </div>

            <div className="codes-tools">

              <input
                type="text"
                placeholder="🔎 Cerca codice o premio..."
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
              />

              <button
                className="refresh-button"
                onClick={loadCodes}
                disabled={loadingCodes}
              >
                🔄
              </button>

            </div>

          </div>

          <div className="codes-table-wrapper">

            <table className="codes-table">

              <thead>

                <tr>

                  <th>
                    CODICE
                  </th>

                  <th>
                    RUOTA
                  </th>

                  <th>
                    STATO
                  </th>

                  <th>
                    RISULTATO
                  </th>

                  <th>
                    UTILIZZATO
                  </th>

                  <th />

                </tr>

              </thead>

              <tbody>

                {filteredCodes.length === 0 ? (

                  <tr>

                    <td
                      colSpan="6"
                      className="empty-table"
                    >
                      {loadingCodes
                        ? 'Caricamento...'
                        : 'Nessun codice trovato.'}
                    </td>

                  </tr>

                ) : (

                  filteredCodes.map(
                    (item) => (

                      <tr
                        key={item.code}
                      >

                        <td>

                          <span className="table-code">
                            {item.code}
                          </span>

                        </td>

                        <td>

                          <span className="wheel-name">
                            {item.wheelName}
                          </span>

                        </td>

                        <td>

                          {item.used ? (

                            <span className="status used">
                              🔴 UTILIZZATO
                            </span>

                          ) : (

                            <span className="status available">
                              🟢 DISPONIBILE
                            </span>

                          )}

                        </td>

                        <td>

                          {item.prize ? (

                            <span className="prize-result">

                              <span>
                                {item.prize.emoji}
                              </span>

                              <strong>
                                {item.prize.label}
                              </strong>

                            </span>

                          ) : (

                            <span className="not-used">
                              —
                            </span>

                          )}

                        </td>

                        <td>

                          <span className="date">
                            {formatDate(
                              item.usedAt
                            )}
                          </span>

                        </td>

                        <td>

                          <button
                            className="copy-table-button"
                            onClick={() =>
                              copyCode(
                                item.code
                              )
                            }
                          >
                            📋
                          </button>

                        </td>

                      </tr>

                    )
                  )

                )}

              </tbody>

            </table>

          </div>

        </section>

        {/* FOOTER */}

        <footer className="admin-footer">

          LOS SANTOS CUSTOM

          <span>
            •
          </span>

          RUOTA DELLA FORTUNA

          <span>
            •
          </span>

          ADMIN PANEL

        </footer>

      </section>

    </main>
  )
}

export default App
