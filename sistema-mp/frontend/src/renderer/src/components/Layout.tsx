import { useState } from 'react'
import type { ComponentType } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  ClipboardList,
  FileEdit,
  PackageCheck,
  PackageX,
  Boxes,
  History,
  LogOut,
  Menu
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useAuth } from '@renderer/lib/AuthContext'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  children?: NavItem[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/crear-ot', label: 'Crear OT', icon: FileEdit },
  {
    to: '/entrega',
    label: 'Registrar Entrega',
    icon: PackageCheck,
    children: [{ to: '/entrega/historial', label: 'Historial de OT', icon: History }]
  },
  { to: '/devolucion', label: 'Registrar Devolución', icon: PackageX },
  { to: '/consulta', label: 'Consultar OT', icon: ClipboardList },
  { to: '/materiales', label: 'Materiales', icon: Boxes }
]

function navLinkClasses(isActive: boolean, indent = false): string {
  return cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    indent && 'pl-8',
    isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
  )
}

function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const perteneceAlGrupo =
    pathname === item.to || (item.children?.some((c) => pathname === c.to) ?? false)
  const [abierto, setAbierto] = useState(perteneceAlGrupo)
  const Icon = item.icon

  return (
    <div>
      <div className={cn('flex items-center rounded-md', pathname === item.to ? '' : '')}>
        <NavLink to={item.to} className={() => cn(navLinkClasses(pathname === item.to), 'flex-1')}>
          <Icon className="h-4 w-4" />
          {item.label}
        </NavLink>
        <button
          onClick={() => setAbierto((v) => !v)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={abierto ? 'Contraer' : 'Expandir'}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', abierto && 'rotate-180')} />
        </button>
      </div>
      {abierto && (
        <div className="mt-1 flex flex-col gap-1">
          {item.children!.map((child) => (
            <NavLink key={child.to} to={child.to} className={({ isActive }) => navLinkClasses(isActive, true)}>
              <child.icon className="h-3.5 w-3.5" />
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { sesion, cerrarSesion } = useAuth()
  const location = useLocation()
  const [abierto, setAbierto] = useState(true)

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className={cn(
          'shrink-0 overflow-hidden border-r border-border bg-card transition-all duration-200',
          abierto ? 'w-64' : 'w-0 border-r-0'
        )}
      >
        <div className="flex h-full w-64 flex-col p-4">
          <div className="mb-6 flex items-center justify-between px-2">
            <div>
              <p className="text-sm font-semibold">ZEPOL</p>
              <p className="text-xs text-muted-foreground">Control de Materia Prima</p>
            </div>
            <button
              onClick={() => setAbierto(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Ocultar menú"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map((item) =>
              item.children ? (
                <NavGroup key={item.to} item={item} pathname={location.pathname} />
              ) : (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => navLinkClasses(isActive)}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              )
            )}
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
        </div>
      </aside>

      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          className="fixed left-4 top-4 z-50 rounded-md border border-border bg-card p-2 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          aria-label="Mostrar menú"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

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
