import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: ["coverage/**", ".next/**", "node_modules/**", ".cursor/**", "ecc-reference/**"],
  },
  ...nextVitals,
  {
    rules: {
      "@next/next/no-page-custom-font": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
