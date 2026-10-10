import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './lib/supabase/client';
import { installModuleLoadRecovery } from './services/moduleLoadRecovery';

installModuleLoadRecovery();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
