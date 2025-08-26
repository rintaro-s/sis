import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  // Ignore build outputs and generated Tauri artifacts
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Loosen a few rules to accommodate gradual typing and stubs
      '@typescript-eslint/no-explicit-any': 'off',
  'no-empty': 'off',
  '@typescript-eslint/no-unused-vars': 'warn',
  'react-refresh/only-export-components': 'off',
  'no-useless-escape': 'off',
    },
  },
])
