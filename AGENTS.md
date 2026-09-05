# SistemaWISP Agent Instructions

## Repository Layout

- `frontend/` is the standalone Angular 21 application; `src/main.ts` bootstraps the app, routes are in `src/app/app.routes.ts`, and shared API/auth code is under `src/app/core/`.
- `backend/` is the FastAPI application. Run it from `backend/` so the `app` imports resolve and `.env` is loaded; `app/main.py` is the entrypoint.
- Backend HTTP routes live in `backend/app/routes/`, business logic in `backend/app/services/`, and SQLAlchemy models/schemas in their corresponding `app/models/` and `app/schemas/` directories.

## Commands

- Frontend commands must run from `frontend/`: `npm ci`, `npm start`, `npm run build`, and `npm test`.
- Frontend tests use Vitest through Angular CLI. A focused test file can be run with `npm test -- --include src/app/features/usuarios/usuarios.component.spec.ts`.
- Start the backend from `backend/` with `python -m uvicorn app.main:app --reload` after installing `requirements.txt` and creating `.env` from `.env.example`.
- There is no configured backend test, lint, typecheck, e2e, or migration runner; do not assume `pytest`, `ng e2e`, or Alembic commands exist.

## Runtime And Data

- The backend requires PostgreSQL at the configured `DATABASE_URL`; it does not create tables on startup. Apply `backend/migrations/001_permisos_y_email_opcional.sql` and then `backend/migrations/002_planes.sql` manually, with the base `usuarios` and `roles` tables already present.
- Backend settings read `.env` relative to the current working directory. Keep backend server commands rooted in `backend/`; never commit the real `backend/.env` or secrets.
- The frontend API base URL is hardcoded as `http://127.0.0.1:8000` in `frontend/src/app/core/config/api.config.ts`; change it there together with backend `CORS_ORIGINS` when changing hosts or ports.

## Implementation Notes

- Keep frontend components standalone, `ChangeDetectionStrategy.OnPush`, and signal-based, matching the existing feature components. TypeScript and Angular templates are strict (`frontend/tsconfig.json`). Format with the repository Prettier config (`frontend/.prettierrc`).
- The auth interceptor adds the bearer token to every non-login request; `/api/auth/me` and all user/module endpoints therefore require a running authenticated backend.
- User creation/update is administrator-only and requires at least two active module IDs. Deactivating the currently authenticated administrator is explicitly rejected by the backend.
- The migration seeds the `modulos` catalog and grants all seeded modules to existing users; preserve this behavior when changing permission or user data flows.
