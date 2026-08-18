import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import type { Modulo } from './lib/types'
import { Login } from './pages/Login'
import { Layout } from './components/Layout'
import { RegistrarEntrega } from './pages/RegistrarEntrega'
import { RegistrarDevolucion } from './pages/RegistrarDevolucion'
import { Consulta } from './pages/Consulta'
import { Materiales } from './pages/Materiales'
import { Maquinas } from './pages/Maquinas'
import { ConfiguracionExcel } from './pages/ConfiguracionExcel'
import { RegistroSid } from './pages/RegistroSid'
import { Historial } from './pages/Historial'
import { DetalleOt } from './pages/DetalleOt'
import { ListadoOt } from './pages/ListadoOt'
import { Usuarios } from './pages/Usuarios'

function RutaPrivada({ children }: { children: ReactNode }) {
  const { sesion } = useAuth()
  if (!sesion) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RutaConAcceso({ modulo, children }: { modulo: Modulo; children: ReactNode }) {
  const { tieneAcceso } = useAuth()
  if (!tieneAcceso(modulo)) return <Navigate to="/entrega" replace />
  return <>{children}</>
}

function RutaAdmin({ children }: { children: ReactNode }) {
  const { sesion } = useAuth()
  if (sesion?.usuario.rol !== 'admin') return <Navigate to="/entrega" replace />
  return <>{children}</>
}

export default function App() {
  const { sesion } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={sesion ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <RutaPrivada>
            <Layout />
          </RutaPrivada>
        }
      >
        <Route index element={<Navigate to="/entrega" replace />} />
        <Route
          path="entrega"
          element={
            <RutaConAcceso modulo="registrar_entrega">
              <RegistrarEntrega />
            </RutaConAcceso>
          }
        />
        <Route
          path="devolucion"
          element={
            <RutaConAcceso modulo="registrar_devolucion">
              <RegistrarDevolucion />
            </RutaConAcceso>
          }
        />
        <Route path="consulta" element={<Consulta />} />
        <Route
          path="materiales"
          element={
            <RutaConAcceso modulo="materiales">
              <Materiales />
            </RutaConAcceso>
          }
        />
        <Route
          path="maquinas"
          element={
            <RutaConAcceso modulo="maquinas">
              <Maquinas />
            </RutaConAcceso>
          }
        />
        <Route
          path="configuracion/excel"
          element={
            <RutaConAcceso modulo="excel_oc_mp">
              <ConfiguracionExcel />
            </RutaConAcceso>
          }
        />
        <Route
          path="sid"
          element={
            <RutaConAcceso modulo="registro_sid">
              <RegistroSid />
            </RutaConAcceso>
          }
        />
        <Route
          path="entrega/historial"
          element={
            <RutaConAcceso modulo="registrar_entrega">
              <Historial />
            </RutaConAcceso>
          }
        />
        <Route
          path="crear-ot"
          element={
            <RutaConAcceso modulo="crear_ot">
              <DetalleOt />
            </RutaConAcceso>
          }
        />
        <Route
          path="crear-ot/listado"
          element={
            <RutaConAcceso modulo="crear_ot">
              <ListadoOt />
            </RutaConAcceso>
          }
        />
        <Route
          path="usuarios"
          element={
            <RutaAdmin>
              <Usuarios />
            </RutaAdmin>
          }
        />
      </Route>
    </Routes>
  )
}
