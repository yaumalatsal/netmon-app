# Custom IT Ops Dashboard (Network Monitoring + Inventory + Traffic + Topology)

This is a multi-site network monitoring dashboard client featuring an interactive React Flow topology builder, automatic Mikrotik config lease ingestion, SNMP/Ping crawl sweeps (and high-fidelity simulation), and WAN traffic monitoring.

## Folder Structure
- `/backend`: Node.js + TypeScript Express API server and WebSocket poller.
- `/frontend`: Vite + React + TypeScript + custom dark Glassmorphic layout.

---

## Quick Start (Zero Config SQLite Development Mode)

To run the application out-of-the-box using the SQLite database fallback:

### 1. Start the Backend Server
```bash
cd backend
npm install
npm run seed  # Parses the lease config from Downloads
npm run dev   # Starts backend on http://localhost:5000 and websocket on /ws
```

### 2. Start the Frontend Server
```bash
cd frontend
npm install
npm run dev   # Starts Vite server on http://localhost:3000
```
Then open [http://localhost:3000](http://localhost:3000) in your browser!

---

## Production Deployment (PostgreSQL Mode)

To switch to PostgreSQL mode on your VPS:

1. Start PostgreSQL using Docker Compose:
   ```bash
   docker-compose up -d
   ```
2. Set the database type and connection string in `backend/.env`:
   ```env
   DB_TYPE=postgres
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/netmon
   SIMULATION_MODE=false
   ```
3. Restart the backend. It will automatically apply the schemas located in `backend/src/db/schema.sql`.
