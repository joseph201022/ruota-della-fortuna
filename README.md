# LSC — Ruota della Fortuna

Questa cartella contiene due applicazioni separate:

- `frontend`: sito React/Vite, incluso il pannello admin su `/admin`.
- `backend`: API Express che genera, verifica e registra i codici.

## Primo avvio

Apri due terminali nella cartella del progetto.

### 1. Backend

```powershell
cd backend
Copy-Item .env.example .env
# Apri .env e imposta ADMIN_PASSWORD con una password privata.
npm install
npm start
```

Il server API sarà disponibile su `http://localhost:3001`.

### 2. Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Apri l'indirizzo mostrato nel terminale, normalmente `http://localhost:5173`.
Il pannello amministratore è `http://localhost:5173/admin`.

## Dati

Alla prima esecuzione il backend crea automaticamente `backend/data/codes.json`.
Conserva quel file: contiene i codici generati e i premi già estratti.
