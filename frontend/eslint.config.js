import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default ts.config(
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**', 'public/**', 'dist/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{ts,js,vue}'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { 'vue/multi-word-component-names': 'off' },
  },
)
