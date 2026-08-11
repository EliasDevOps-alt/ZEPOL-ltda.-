import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardList, PackageCheck, PackageX, Boxes, LogOut } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useAuth } from '@renderer/lib/AuthContext'

const NAV_ITEMS = [
  { to: '/entrega', label: 'Registrar Entrega', icon: PackageCheck },
  { to: '/devolucion', label: 'Registrar Devolución', icon: PackageX },
  { to: '/consulta', label: 'Consultar OT', icon: ClipboardList },
  { to: '/materiales', label: 'Materiales', icon: Boxes }
]

export function Layout() {
  const { sesion, cerrarSesion } = useAuth()
  const location = useLocation()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold">ZEPOL</p>
          <p className="text-xs text-muted-foreground">Control de Materia Prima</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-border pt-3">
          <p className="px-2 text-sm font-medium">{sesion?.usuario.nombre}</p>
          <button
            onClick={cerrarSesion}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
