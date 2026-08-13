import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import { Login } from './pages/Login'
import { Layout } from './components/Layout'
import { RegistrarEntrega } from './pages/RegistrarEntrega'
import { RegistrarDevolucion } from './pages/RegistrarDevolucion'
import { Consulta } from './pages/Consulta'
import { Materiales } from './pages/Materiales'
import { Maquinas } from './pages/Maquinas'
import { ConfiguracionExcel } from './pages/ConfiguracionExcel'
import { Historial } from './pages/Historial'
import { DetalleOt } from './pages/DetalleOt'

function RutaPrivada({ children }: { children: ReactNode }) {
  const { sesion } = useAuth()
  if (!sesion) return <Navigate to="/login" replace />
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
        <Route path="entrega" element={<RegistrarEntrega />} />
        <Route path="devolucion" element={<RegistrarDevolucion />} />
        <Route path="consulta" element={<Consulta />} />
        <Route path="materiales" element={<Materiales />} />
        <Route path="maquinas" element={<Maquinas />} />
        <Route path="configuracion/excel" element={<ConfiguracionExcel />} />
        <Route path="entrega/historial" element={<Historial />} />
        <Route path="crear-ot" element={<DetalleOt />} />
      </Route>
    </Routes>
  )
}
