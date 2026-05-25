import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import EngineerProfile from './pages/EngineerProfile'
import Reports from './pages/Reports'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/engineer/:id" element={<EngineerProfile />} />
      <Route path="/reports" element={<Reports />} />
    </Routes>
  )
}
