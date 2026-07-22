import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import EngineerProfile from './pages/EngineerProfile'
import Reports from './pages/Reports'
import Releases from './pages/Releases'
import MonthlyReview from './pages/MonthlyReview'
import MonthlyReviewLive from './pages/MonthlyReviewLive'
import TeamGantt from './pages/TeamGantt'
import TaskBoard from './pages/TaskBoard'
import Roadmap from './pages/Roadmap'
import NorthStar from './pages/NorthStar'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/engineer/:id" element={<EngineerProfile />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/releases" element={<Releases />} />
      <Route path="/review/june-2026" element={<MonthlyReview />} />
      <Route path="/monthly-review" element={<MonthlyReviewLive />} />
      <Route path="/team-gantt" element={<TeamGantt />} />
      <Route path="/tasks" element={<TaskBoard />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/north-star" element={<NorthStar />} />
    </Routes>
  )
}
