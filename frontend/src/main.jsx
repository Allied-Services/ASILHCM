// Build v2026.05.08 — Attendance Management Module
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// #region agent log
fetch('http://127.0.0.1:7681/ingest/e193b6d7-95a0-49cb-9d01-81662d58f7db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bac354'},body:JSON.stringify({sessionId:'bac354',runId:'post-fix',hypothesisId:'A',location:'main.jsx:boot',message:'JS bundle executed',data:{pathname:typeof window!=='undefined'?window.location.pathname:'',readyState:typeof document!=='undefined'?document.readyState:''},timestamp:Date.now()})}).catch(()=>{});
// #endregion
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
