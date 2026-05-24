/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        panelEdgeFlow: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        panelEdgeFlowRev: {
          "0%": { backgroundPosition: "200% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
      },
      animation: {
        "panel-edge-flow": "panelEdgeFlow 2.8s linear infinite",
        "panel-edge-flow-rev": "panelEdgeFlowRev 2.8s linear infinite",
      },
    },
  },
  plugins: [],
}