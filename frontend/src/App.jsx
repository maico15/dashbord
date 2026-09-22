import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import EngineerProfile from './pages/EngineerProfile'
import Reports from './pages/Reports'
import Releases from './pages/Releases'
import MonthlyReview from './pages/MonthlyReview'
import MonthlyReviewCurated from './pages/MonthlyReviewCurated'
import MonthlyReviewLive from './pages/MonthlyReviewLive'
import TeamGantt from './pages/TeamGantt'
import TeamPlan from './pages/TeamPlan'
import TaskBoard from './pages/TaskBoard'
import Roadmap from './pages/Roadmap'
import NorthStar from './pages/NorthStar'
import ITBacklog from './pages/ITBacklog'
import ITRequestForm from './pages/ITRequestForm'
import ITRequestStatus from './pages/ITRequestStatus'
import ITRequestsMine from './pages/ITRequestsMine'
import ITRequestsAdmin from './pages/ITRequestsAdmin'
import MonthlyReviewLatest from './pages/MonthlyReviewLatest'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/engineer/:id" element={<EngineerProfile />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/releases" element={<Releases />} />
      {/* Legacy path — no params, so the page falls back to August 2026. */}
      <Route path="/review/august-2026" element={<MonthlyReviewCurated />} />
      <Route path="/review/june-2026" element={<MonthlyReview />} />
      {/* Stable address for "the newest review" — what the footer links to. */}
      <Route path="/review/latest" element={<MonthlyReviewLatest />} />
      <Route path="/review/:year/:month" element={<MonthlyReviewCurated />} />
      <Route path="/monthly-review" element={<MonthlyReviewLive />} />
      <Route path="/team-gantt" element={<TeamGantt />} />
      <Route path="/team-plan" element={<TeamPlan />} />
      <Route path="/tasks" element={<TaskBoard />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/north-star" element={<NorthStar />} />
      {/* Hidden page: intentionally absent from every nav, tab bar and link.
       * Reachable only by typing /it-backlog. */}
      <Route path="/it-backlog" element={<ITBacklog />} />

      {/* IT requests. The first three are public; /admin asks for the password
        * itself and, like /it-backlog, is not in the tab bar. */}
      <Route path="/it-requests" element={<ITRequestForm />} />
      <Route path="/it-requests/status" element={<ITRequestStatus />} />
      <Route path="/it-requests/status/:ref" element={<ITRequestStatus />} />
      <Route path="/it-requests/mine" element={<ITRequestsMine />} />
      <Route path="/it-requests/admin" element={<ITRequestsAdmin />} />
    </Routes>
  )
}
