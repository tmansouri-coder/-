import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';
import { AuthProvider } from './contexts/AuthContext';
import { AcademicYearProvider } from './contexts/AcademicYearContext';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AcademicYearProvider>
          <App />
        </AcademicYearProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
