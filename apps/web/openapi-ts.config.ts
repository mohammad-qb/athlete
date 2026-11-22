import { defineConfig } from '@hey-api/openapi-ts';

/**
 * The typed API client, generated from the document the API generates from its own
 * routes and Zod contracts (`apps/api/openapi.json`). Nothing under the output folder
 * is edited by hand; CI regenerates it and fails on a difference.
 *
 * No schema plugin on purpose: forms validate with the Zod schemas in
 * `@athlete/contracts` directly, and a second generated copy of them would be a second
 * source of truth.
 */
export default defineConfig({
  input: '../api/openapi.json',
  output: 'src/lib/api/generated',
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@tanstack/react-query',
  ],
});
