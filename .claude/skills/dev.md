# /dev - Start Development Servers

Start the development environment for the project.

## Usage
```
/dev [frontend|backend|all]
```

## Instructions

1. **Start frontend only**:
```bash
cd frontend && npm run dev
```
- Runs Next.js dev server on port 3000
- Hot reloading enabled
- Access at http://localhost:3000

2. **Start backend only**:
```bash
cd backend && npm run dev
```
- Runs Express dev server with nodemon
- Auto-restarts on file changes

3. **Start both** (recommended - run in separate terminals):

Terminal 1 - Frontend:
```bash
cd frontend && npm run dev
```

Terminal 2 - Backend:
```bash
cd backend && npm run dev
```

4. **Environment setup**:
- Ensure `.env` files exist in both `frontend/` and `backend/`
- Required backend env vars: Database connections, API keys
- Required frontend env vars: Clerk keys

5. **Common issues**:
- Port 3000 in use: `lsof -i :3000` to find process, `kill -9 <PID>` to free
- Database connection errors: Check env vars and VPN if needed
- Missing dependencies: Run `npm install` in the failing directory

6. **Database connections** (backend requires):
- MySQL pools for main data
- PostgreSQL (Railway) for invoice data
- Redis for caching
