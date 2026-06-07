/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        background: {
          DEFAULT: "#0a1628",
          light: "#0f1f3a",
          dark: "#050d18",
        },
        fluid: {
          cyan: "#00d4ff",
          blue: "#0066ff",
          purple: "#6366f1",
        },
        accent: {
          pink: "#ff0080",
          yellow: "#ffd700",
        },
        panel: {
          bg: "rgba(10, 22, 40, 0.85)",
          border: "rgba(0, 212, 255, 0.3)",
        },
      },
      fontFamily: {
        mono: ["Space Mono", "monospace"],
        sans: ["Inter", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(0, 212, 255, 0.3)",
        "glow-pink": "0 0 20px rgba(255, 0, 128, 0.5)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
