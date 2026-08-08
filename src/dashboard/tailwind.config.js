/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1eefe", 100: "#e2dcfd", 200: "#c5b8fb", 300: "#b3a2ff",
          400: "#9b87ff", 500: "#7c5cff", 600: "#6b3df0", 700: "#5a2dd6",
        },
        status: { pass: "#3fd68a", run: "#f0b440", fail: "#f06161", pause: "#7c8cb0" },
        ink: {
          950: "#0a0b12", 900: "#11131d", 850: "#161926", 800: "#1a1d2b",
          700: "#272b3d", 600: "#3a3f56", 500: "#6b7090", 300: "#aab0cc", 100: "#e6e8f2",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
        display: ["var(--font-bricolage)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7c5cff 0%, #c94dff 100%)",
        "dot-grid": "radial-gradient(circle, #1c2032 1px, transparent 1px)",
      },
      backgroundSize: { grid: "22px 22px" },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.35), 0 8px 30px -8px rgba(124,92,255,0.45)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        pulseDot: "pulseDot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
