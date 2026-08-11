# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo (`e:\ZEPOL`) is a single git repository (root here, not per-subfolder) containing:

- `For_contro_mp v.1.xlsx` / `Sin título.xlsm` — the original Excel/VBA raw-material control system used by ZEPOL Ltda. (a flexible-packaging plant: printing, lamination, extrusion, slitting, pouching). These are the source of truth for the business rules the new system replaces; keep them for reference, don't edit them.
- `sistema-mp/` — the replacement desktop system being built: a FastAPI backend + an Electron/React desktop client, sharing one PostgreSQL database, meant to run on a machine on the plant's LAN that the other station PCs connect to.

## Commands

### Backend (`sistema-mp/backend`)

```
.venv\Scripts\activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

- Venv uses **Python 3.12** (`py -3.12 -m venv .venv`), not the system's Python 3.8 — the codebase relies on syntax that only works reliably under 3.10+.
- DB connection and JWT secret come from `.env` (see `.env.example`); `database.py` calls `load_dotenv()` automatically.
- No test suite or migration tool (Alembic is installed but unused) exists yet — schema changes are applied by hand against `db/schema.sql`.
- Set/reset a user's login password: `python scripts/set_password.py <INICIAL>` (e.g. `ER` for Erasmo).

### Database

- `db/schema.sql` — full DDL, the source of truth for the schema. Run it against a fresh `zepol_mp` database with `psql -U zepol -d zepol_mp -h localhost -f db/schema.sql`.
- `db/seed_master_data.sql` — master data extracted from the original Excel (procesos, máquinas, estados_sid, usuarios, and the 564 rows of `materiales`). `material_procesos` (which materials are allowed in which process) is intentionally **not** seeded — that mapping doesn't exist in the source Excel and has to be curated by hand through the Materiales admin screen.
- There is no migration tool wired up. When `models.py` and `schema.sql` diverge, changes are applied to the live DB by hand with `ALTER`/`DROP`+recreate via `psql`, then both files are kept in sync manually.

### Frontend (`sistema-mp/frontend`)

```
npm run dev      # electron-vite dev server + Electron window
npm run build    # typecheck-free production bundle (main+preload+renderer)
npm run dist     # build + electron-builder installer
npx tsc -b --noEmit   # typecheck only
```

- Uses Vite 7 pinned deliberately — `electron-vite` doesn't yet support Vite 8, and `@vitejs/plugin-react` is pinned to `^4` for the same reason. Don't bump either without checking `electron-vite` compatibility first.
- Only one dev instance should run at a time. `npm run dev` spawns Electron + a Vite dev server (port 5173, auto-increments if busy); killing the terminal doesn't always kill the child `electron.exe`/`node.exe` processes cleanly, and stale ones left running cause the next launch to silently fail to hot-reload or fail to fetch data. If a screen shows unexpectedly empty/stale data, check for leftover `electron.exe`/`node.exe` processes before assuming it's a backend/DB bug.
- **`ELECTRON_RUN_AS_NODE`**: if this env var is set in the shell (some tooling sets it), any `electron` binary launched from that shell runs as plain Node instead of a real Electron app and crashes on `electron.app.getPath`. Unset it for the dev command: `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Architecture

### Backend: Model / Controller / View split

`app/` is organized as MVC, but note the FastAPI-specific meaning of "View": there's no HTML/templates, `views/*.py` are just the route handlers (naming borrowed from Django's convention of calling a request handler a "view" even without one).

- `models.py` — SQLAlchemy ORM (single file, all tables).
- `schemas.py` — Pydantic request/response shapes (single file).
- `controllers/*_controller.py` — all business logic and validation. Route handlers never touch the DB or raise domain errors directly; that all lives here.
- `views/*_view.py` — thin: parse request → call controller → shape response with a `_serializar()` helper. Each view file owns its own serializer rather than sharing one, because each response shape pulls in different relationship data.
- `main.py` wires the view routers together.

The real presentation layer (what the user sees) is the separate Electron/React app, not anything in this backend.

### Core domain model: OT → OtProceso → OtMaterial → Entrega/Devolucion

This is the part that needs multiple files to understand, so it's worth internalizing before touching `entregas_controller.py`, `devoluciones_controller.py`, or `models.py`:

- An **`OrdenTrabajo`** (OT) is created lazily the first time it's referenced by number — there's no separate "create OT" endpoint.
- An OT goes through one or more **`OtProceso`** steps — (OT, proceso, máquina). A `Maquina` belongs to exactly one `Proceso`; the composite FK `(maquina_id, proceso_id) → maquinas(id, proceso_id)` makes an invalid combination (e.g. Confección with máquina F4) impossible at the DB level, not just in application code.
- Under one `OtProceso`, each material requested is its own **`OtMaterial`** ("pedido") with its own `cantidad_requerida`. One OT+proceso step commonly has several pedidos (e.g. OT 2121 in Laminación needs 500kg of PA15520 *and* 200kg of PA15V — two `OtMaterial` rows under the same `OtProceso`). The composite FK `(material_id, proceso_id) → material_procesos(...)` enforces that only materials explicitly enabled for that proceso (via the Materiales admin screen) can be requested there.
- **`Entrega`** rows are partial or full deliveries against one `OtMaterial` — several entregas (different dates) commonly target the same pedido (e.g. 200kg today, 300kg tomorrow, summing toward the 500kg required). `cantidad_requerida` is only honored on the *first* entrega for a given `OtMaterial`; later entregas against the same pedido ignore that field.
- **`Devolucion`** rows also hang off `OtMaterial`, not off a specific `Entrega` — once material is on the floor it's no longer attributable to a specific delivery batch, so a devolución is validated against the *cumulative* entregado/devuelto totals for that pedido (see `pedidos_controller.total_entregado_pedido` / `total_devuelto_pedido`), not against a single entrega.
- `vista_consumo` (a SQL view) is the one-row-per-`OtMaterial` summary (required/entregado/devuelto/neto) that both the "Consulta" screen and the devolución material-picker read from; `consumo_controller` adds a computed `estado_entrega` (PENDIENTE/PARCIAL/COMPLETO) on top by comparing `cantidad_requerida` to the delivered total.
- Composite FKs throughout (`ot_procesos`, `ot_materiales`, `entregas`) exist specifically to make the "máquina must belong to the chosen proceso" / "material must be enabled for the chosen proceso" rules unbreakable at the database layer, not just validated in `controllers/`. When adding a new table that references one of these, prefer extending the composite-FK pattern over re-validating in Python alone.
- Bobina weight rows (`entrega_bobinas`, `devolucion_bobinas`) deliberately have **no unit column** — the unit always comes from `Material.unidad`. This was a specific fix for a real data-entry risk (operators mixing kg/units) in the original Excel workflow; don't add a per-row unit field back in.
- `estado_sid` lives only on `OtMaterial` (not on individual entregas/devoluciones) — it's a plant-side external tracking status ("SID") for the pedido as a whole, still evolving; don't assume PENDIENTE/REGISTRADO/CORREGIR/CORREGIDO/ANULADO is the final set.

### Frontend structure

- `src/main/` — Electron main process. Owns a small JSON config file (`app.getPath('userData')/config.json`, IPC channel `config:get`/`config:set`) storing `apiBaseUrl` — this is how each station PC points at the LAN server IP; there is no build-time env var for it.
- `src/preload/` — contextBridge exposing `window.api.{getConfig,setConfig}` to the renderer.
- `src/renderer/src/lib/` — `ConfigContext` (apiBaseUrl), `AuthContext` (JWT + usuario, persisted to `localStorage`, so a station stays logged in across restarts), `api.ts` (plain fetch wrapper; every function takes `baseUrl`/`token` explicitly rather than reading context internally, so it stays framework-agnostic and easy to call from TanStack Query hooks).
- `src/renderer/src/components/ui/` — hand-built shadcn-style primitives (not the shadcn CLI/package) — Button, Input, Label, Card, Select. Follow this pattern (Radix primitive + `cva` + `cn()`) rather than pulling in a component library.
- Routing is `HashRouter` (not `BrowserRouter`) — required because the production build is loaded via `file://`, which doesn't support path-based routing.
- Catalog queries (procesos/máquinas/materiales) must surface `isError` state in the UI rather than failing silently — an empty dropdown with no error message is a real support problem on the plant floor (this bit already once: see git history / conversation — always show a retry banner, don't just let the `<Select>` render empty).

### Styling

Color tokens are Tailwind v4 `@theme` variables in `src/renderer/src/index.css` — no `tailwind.config.js`. The palette is fixed light-only on purpose (no `prefers-color-scheme` dark variant): this is a shop-floor app used by non-technical operators on shared PCs, and it must not silently go dark based on whichever Windows theme a given station happens to have. `--color-primary` is the cyan from the ZEPOL logo; `--color-accent-*` are the logo's decorative circle colors (used sparingly, e.g. the login card's top gradient bar); `success`/`warning`/`destructive` are semantic status colors, not brand colors — use them by meaning (COMPLETO/PARCIAL/error), not decoratively.
