import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

/**
 * Two lint environments, because the project has two runtimes.
 *
 * `tsconfig.node.json` compiles main, preload and shared and deliberately
 * carries no DOM lib, so that main-process code cannot reach for `document` by
 * accident. The lint config follows the same split rather than blanket-enabling
 * `browser` — a rule that suggests `window.something` in the main process would
 * be advice the type checker has already been told to refuse.
 */
export default tseslint.config(
  {
    ignores: ["out/**", "release/**", "node_modules/**", "*.mjs", "scripts/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- main, preload, shared: Node, no DOM ----
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // A catch that ignores its error is deliberate in this codebase and is
      // commented where it happens; the rule would fire on dozens of those.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Non-null assertions are used sparingly and read clearly; the type
      // checker already knows what it does not know.
      "@typescript-eslint/no-non-null-assertion": "off",
      // `require` for a Node builtin is used on purpose where the module is
      // only needed on one branch, so that starting OpenCode does not pay for
      // it. A top-level import would change what gets loaded when.
      "@typescript-eslint/no-require-imports": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // ---- renderer: browser, DOM, React ----
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // ---- fast refresh, where it does not apply ----
  //
  // The rule is about hot reload losing state, and it is worth having in a view.
  // It does not apply to a renderer entry point (nothing to refresh) nor to the
  // two libraries that deliberately export a component next to the helpers and
  // constants that belong with it — splitting those would scatter one idea
  // across two files to satisfy a development-time nicety.
  {
    files: [
      "src/renderer/src/hud.tsx",
      "src/renderer/src/lib/store.tsx",
      "src/renderer/src/lib/messageMove.tsx",
      "src/renderer/src/components/CodeBlock.tsx",
      "src/renderer/src/components/ContextRing.tsx",
      "src/renderer/src/components/SessionBoard.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // ---- the few globals that are ours ----
  {
    files: ["src/renderer/**/*.tsx"],
    languageOptions: {
      globals: { JSX: "readonly" },
    },
  },
)
