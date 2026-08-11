# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo (`e:\ZEPOL`) is a single git repository (root here, not per-subfolder) containing:

- `For_contro_mp v.1.xlsx` / `Sin título.xlsm` — the original Excel/VBA raw-material control system used by ZEPOL Ltda. (a flexible-packaging plant: printing, lamination, extrusion, slitting, pouching). These are the source of truth for the business rules the new system replaces; keep them for reference, don't edit them.
- `sistema-mp/` — the replacement desktop system being built: a FastAPI backend + an Electron/React desktop client, sharing one PostgreSQL database, meant to run on a machine on the plant's LAN that the other station PCs connect to.

Remote: `origin` → `https://github.com/EliasDevOps-alt/ZEPOL-ltda.-.git` (`main`, pushed).

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
- `db/seed_master_data.sql` — master data extracted from the original Excel (procesos, máquinas, estados_sid, usuarios, and the 564 rows of `materiales`).
- There is no migration tool wired up. When `models.py` and `schema.sql` diverge, changes are applied to the live DB by hand with `ALTER`/`DROP`+recreate via `psql`, then both files are kept in sync manually.
- **Gotcha that has already caused a real bug**: `vista_consumo` is a SQL `VIEW`. Editing its `CREATE VIEW` text in `schema.sql` does **not** change the live database — Postgres won't let you `ALTER` a view's column list, so the live view has to be explicitly `DROP VIEW` + recreated from the updated SQL every time its definition changes, or every consumer (`consumo_controller`, anything doing `SELECT *` from it) breaks with a Pydantic "field required" 500 the next time a field is added. Regression-test `GET /consumo` after any schema change that touches this view.

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

This is the part that needs multiple files to understand, so it's worth internalizing before touching `ordenes_controller.py`, `entregas_controller.py`, `devoluciones_controller.py`, or `models.py`:

- An **`OrdenTrabajo`** (OT) has exactly one `cliente`. It does **not** have a `diseño` — design lives one level down, per proceso, because a single OT can carry different designs on different process steps.
- An OT goes through one or more **`OtProceso`** steps — (OT, proceso, máquina, **diseño**). A `Maquina` belongs to exactly one `Proceso`; the composite FK `(maquina_id, proceso_id) → maquinas(id, proceso_id)` makes an invalid combination (e.g. Confección with máquina F4) impossible at the DB level, not just in application code.
- Under one `OtProceso`, each material requested is its own **`OtMaterial`** ("pedido") with its own `cantidad_requerida`. One OT+proceso step commonly has several pedidos (e.g. OT 2121 in Laminación needs 500kg of PA15520 *and* 200kg of PA15V — two `OtMaterial` rows under the same `OtProceso`). Any active `Material` can be requested in any proceso — there used to be a `material_procesos` allow-list table restricting this, but it was **removed** after the plant confirmed the restriction was fictional (e.g. Extrusión genuinely accepts any raw material); don't reintroduce a proceso↔material gate without being asked.
- The OT's whole structure (procesos, their diseños/máquinas, and their pedidos with cantidades) is defined up front through **`POST /ordenes-trabajo/detalle`** (`ordenes_controller.guardar_detalle`) — the "Detalle de OT" screen. This call is idempotent/additive: calling it again for an existing OT updates cliente/diseño or adds more procesos/materiales rather than duplicating rows (matched by the unique constraints on `ot_procesos(ot_id, proceso_id, maquina_id)` and `ot_materiales(ot_proceso_id, material_id)`). **`Entrega`/`Devolucion` no longer create this structure implicitly** — `entregas_controller.registrar_entrega` is now a thin `ot_material_id` lookup, nothing more. If `EntregaCreate` ever needs to grow proceso/máquina/material fields again, that's a sign something regressed back toward the old implicit-creation design; don't do that — extend `OtDetalleCreate` instead.
- **`Entrega`** rows are partial or full deliveries against one `OtMaterial` — several entregas (different dates) commonly target the same pedido (e.g. 200kg today, 300kg tomorrow, summing toward the 500kg required).
- **`Devolucion`** rows also hang off `OtMaterial`, not off a specific `Entrega` — once material is on the floor it's no longer attributable to a specific delivery batch, so a devolución is validated against the *cumulative* entregado/devuelto totals for that pedido (see `pedidos_controller.total_entregado_pedido` / `total_devuelto_pedido`), not against a single entrega.
- `vista_consumo` (a SQL view) is the one-row-per-`OtMaterial` summary (cliente/proceso/diseño/máquina/material/required/entregado/devuelto/neto) that the "Consulta", "Historial de OT", and devolución/entrega pedido-pickers all read from; `consumo_controller` adds a computed `estado_entrega` (PENDIENTE/PARCIAL/COMPLETO) on top by comparing `cantidad_requerida` to the delivered total. See the DB gotcha above — this view has to be manually recreated on the live DB after edits.
- Composite FKs (`ot_procesos.(maquina_id,proceso_id)`, `ot_materiales.(ot_proceso_id,proceso_id)`) exist specifically to make the "máquina must belong to the chosen proceso" rule unbreakable at the database layer, not just validated in `controllers/`. When adding a new table that references one of these, prefer extending the composite-FK pattern over re-validating in Python alone.
- Bobina weight rows (`entrega_bobinas`, `devolucion_bobinas`) deliberately have **no unit column** — the unit always comes from `Material.unidad`. This was a specific fix for a real data-entry risk (operators mixing kg/units) in the original Excel workflow; don't add a per-row unit field back in.
- `estado_sid` lives only on `OtMaterial` (not on individual entregas/devoluciones) — it's a plant-side external tracking status ("SID") for the pedido as a whole, still evolving; don't assume PENDIENTE/REGISTRADO/CORREGIR/CORREGIDO/ANULADO is the final set.

### Frontend structure

- `src/main/` — Electron main process. Owns a small JSON config file (`app.getPath('userData')/config.json`, IPC channel `config:get`/`config:set`) storing `apiBaseUrl` — this is how each station PC points at the LAN server IP; there is no build-time env var for it.
- `src/preload/` — contextBridge exposing `window.api.{getConfig,setConfig}` to the renderer.
- `src/renderer/src/lib/` — `ConfigContext` (apiBaseUrl), `AuthContext` (JWT + usuario, persisted to `localStorage`, so a station stays logged in across restarts), `api.ts` (plain fetch wrapper; every function takes `baseUrl`/`token` explicitly rather than reading context internally, so it stays framework-agnostic and easy to call from TanStack Query hooks).
- `src/renderer/src/components/ui/` — hand-built shadcn-style primitives (not the shadcn CLI/package) — Button, Input, Label, Card, Select. Follow this pattern (Radix primitive + `cva` + `cn()`) rather than pulling in a component library.
- Routing is `HashRouter` (not `BrowserRouter`) — required because the production build is loaded via `file://`, which doesn't support path-based routing.
- Catalog queries (procesos/máquinas/materiales) must surface `isError` state in the UI rather than failing silently — an empty dropdown with no error message is a real support problem on the plant floor (this bit already once — always show a retry banner, don't just let the `<Select>` render empty).
- **No wide tables for lists that can grow** — explicit user requirement ("no quiero que sea como en Excel, con scroll horizontal"). `Historial.tsx` uses a card list (one card per `OtMaterial` pedido, with nested entrega/devolución line items showing bobina count + each bobina's weight) instead of a table; prefer that pattern over adding columns to `Consulta.tsx`'s table, which already pushes the limit at 9 columns.
- **Sidebar nav is hierarchical**, not flat (`components/Layout.tsx`, `NAV_ITEMS`/`NavGroup`) — a top-level item can carry a `children` array rendered as an indented, collapsible sub-list, so the sidebar stays short as more screens get added. "Registrar Entrega" is currently a parent with two children: "Detalle de OT" (`/entrega/detalle`) and "Historial de OT" (`/entrega/historial`). Route paths follow the same nesting (`entrega/detalle`, `entrega/historial` in `App.tsx`) even though React Router treats them as flat sibling routes, not actual `<Outlet>` nesting — the URL hierarchy is just for readability/grouping.
- **OT workflow is a 3-screen pipeline**: `DetalleOt.tsx` (define/extend an OT's procesos+diseños+máquinas+materiales, no bobinas yet — dynamic list of proceso blocks, each with a dynamic list of material rows) → `RegistrarEntrega.tsx` / `RegistrarDevolucion.tsx` (search an OT, pick one of its existing pedidos from `GET /consumo?numero_ot=`, log bobinas — neither screen creates procesos/materiales anymore, both just mirror each other's "search → pick pedido card → bobinas form" shape) → `Historial.tsx` (browse any OT, see every pedido with its full entrega/devolución history). If `RegistrarEntrega` finds zero pedidos for a typed-in OT, it links to `/entrega/detalle` rather than silently letting the user proceed.

### Styling

Color tokens are Tailwind v4 `@theme` variables in `src/renderer/src/index.css` — no `tailwind.config.js`. The palette is fixed light-only on purpose (no `prefers-color-scheme` dark variant): this is a shop-floor app used by non-technical operators on shared PCs, and it must not silently go dark based on whichever Windows theme a given station happens to have. `--color-primary` is the cyan from the ZEPOL logo; `--color-accent-*` are the logo's decorative circle colors (used sparingly, e.g. the login card's top gradient bar); `success`/`warning`/`destructive` are semantic status colors, not brand colors — use them by meaning (COMPLETO/PARCIAL/error), not decoratively.
