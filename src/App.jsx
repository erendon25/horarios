// App.jsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Register from './components/Register';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import CollaboratorDashboard from './components/CollaboratorDashboard';
import WeeklyScheduleEditor from './components/WeeklyScheduleEditor';
import PositioningConfig from './components/PositioningConfig';
import StudyScheduleViewer from './components/StudyScheduleViewer';
import PositionRequirementsWrapper from './components/PositionRequirementsWrapper';
import ConsultaNocturnidad from './components/ConsultaNocturnidad';
import RequireAdmin from "./components/RequireAdmin";
import HolidayForm from './components/HolidayForm';
import StudyScheduleEditor from './components/StudyScheduleEditor';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import SuperAdminDashboard from './components/SuperAdminDashboard';

<ToastContainer />

function AppRouter() {
  const { userRole } = useAuth();
  return (
    <Routes>
      <Route path="/" element={
  <Navigate to={
    userRole === 'superadmin'
      ? '/superadmin'
      : userRole === 'admin'
        ? '/admin'
        : '/staff'
  } />
} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/unauthorized" element={<h1>Acceso no autorizado</h1>} />

      <Route
  path="/admin"
  element={
    <RequireAdmin>
      <AdminDashboard />
    </RequireAdmin>
  }
/>
<Route path="/superadmin" element={
  <PrivateRoute role="superadmin">
    <SuperAdminDashboard />
  </PrivateRoute>
} />

    
      <Route path="/admin/study/:id" element={
        <PrivateRoute role="admin">
          <StudyScheduleViewer />
        </PrivateRoute>
      } />
      <Route path="/admin/study-schedule/:uid" element={
              <PrivateRoute role="admin">
                  <StudyScheduleEditor />
              </PrivateRoute>
          } />

      <Route path="/admin/generate-schedules" element={
        <PrivateRoute role="admin">
          <WeeklyScheduleEditor />
        </PrivateRoute>
      } />

      <Route path="/posiciones" element={
        <PrivateRoute role="admin">
          <PositioningConfig />
        </PrivateRoute>
      } />

      <Route path="/admin/requirements/:day" element={
        <PrivateRoute role="admin">
          <PositionRequirementsWrapper />
        </PrivateRoute>
      } />

      <Route path="/admin/nocturnidad" element={
        <PrivateRoute role="admin">
          <ConsultaNocturnidad />
        </PrivateRoute>
      } />

      <Route path="/horarios" element={
        <PrivateRoute role="admin">
          <WeeklyScheduleEditor />
        </PrivateRoute>
      } />

      <Route path="/staff" element={
        <PrivateRoute role="collaborator">
          <CollaboratorDashboard/>
        </PrivateRoute>
      } />
      <Route path="/staff/study" element={
        <PrivateRoute role="collaborator">
          <StudyScheduleEditor />
         </PrivateRoute>
       } />
     
          <Route

  path="/staff/feriados"
  element={
    <PrivateRoute role="collaborator">
      <HolidayForm />
    </PrivateRoute>
  }
/>
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </Router>
  );
}

export default App;


