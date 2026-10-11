import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { DriverPage } from './pages/Driver';

// A driver link (?t=trip&k=key) opens the driver page without sign-in; everything else is the signed-in app.
const q = new URLSearchParams(location.search);
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode>{q.get('t') && q.get('k') ? <DriverPage tripId={q.get('t')!} k={q.get('k')!} /> : <App />}</StrictMode>);
