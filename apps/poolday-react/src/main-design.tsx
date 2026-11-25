import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignApp } from './app/DesignApp';

const mount = document.getElementById('app');
if (!mount) throw new Error('Missing #app mount for the design page');
createRoot(mount).render(
  <StrictMode>
    <DesignApp />
  </StrictMode>,
);
