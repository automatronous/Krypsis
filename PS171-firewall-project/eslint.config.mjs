import tsParser from "@typescript-eslint/parser";
export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  {
    files: ["**/*.{ts,mts,mjs}"],
    languageOptions: { parser: tsParser },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-eval": "error",
      "no-implied-eval": "error"
    }
  }
];
