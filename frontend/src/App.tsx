import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ReportsListPage from './pages/ReportsListPage';
import ReportDetailPage from './pages/ReportDetailPage';
import AssignmentsPage from './pages/AssignmentsPage';
import ValidationsPage from './pages/ValidationsPage';
import InvitesPage from './pages/InvitesPage';
import MapPage from './pages/MapPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/reports" element={<ReportsListPage />} />
              <Route path="/reports/:id" element={<ReportDetailPage />} />
              <Route path="/assignments" element={<AssignmentsPage />} />
              <Route path="/validations" element={<ValidationsPage />} />
              <Route path="/invites" element={<InvitesPage />} />
              <Route path="/map" element={<MapPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
