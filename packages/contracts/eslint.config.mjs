import { config } from '@athlete/eslint-config/nest';

export default [
  ...config,
  {
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
];
