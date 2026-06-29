// Setup global de Vitest per al panell web.
// Afegeix els matchers de jest-dom (toBeInTheDocument, toHaveTextContent...)
// i neteja el DOM renderitzat després de cada test per evitar fuites entre ells.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
