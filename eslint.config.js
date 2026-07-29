import js from '@eslint/js';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        fetch: 'readonly',
        Audio: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        DOMParser: 'readonly',
        performance: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        atob: 'readonly',
        console: 'readonly',
        MediaMetadata: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
        speechSynthesis: 'readonly',
        matchMedia: 'readonly',
        CustomEvent: 'readonly',
        __GEMINI_API_KEY__: 'readonly',
      },
    },
    rules: {
      // Без react-plugin ESLint не вижда употребата в JSX, затова компонентите
      // (започващи с главна буква) не се броят за неизползвани.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]' }],
      'no-empty': 'off',
    },
  },
];
