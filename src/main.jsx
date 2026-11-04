import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Keeps a copy of the app on this computer, so it opens with no internet (see sw/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.error('Offline copy not set up:', e?.name));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
