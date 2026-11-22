import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only cleans up by itself when the runner's globals are on.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
