// Build v2026.05.08 — Attendance Management Module
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import EmployeePortal from './EmployeePortal.jsx'
import ClientCMMSPortal from './ClientCMMSPortal.jsx'

// Path-based routing lives here, one level above App, so App's own hooks are
// always called unconditionally (moved 2026-07-20 — was previously two early
// returns inside App() before its useState calls, which violates React's
// rules-of-hooks even though it happened to work since pathname is fixed
// for the life of a mounted instance).
const pathname = window.location.pathname;
const RootComponent =
    (pathname === '/portal' || pathname === '/portal/') ? EmployeePortal :
    (pathname === '/cmms' || pathname === '/cmms/') ? ClientCMMSPortal :
    App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
