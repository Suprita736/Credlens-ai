/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cred: {
          low: '#ef4444',     // Red
          medium: '#f59e0b',  // Yellow
          high: '#22c55e',    // Green
        }
      }
    },
  },
  plugins: [],
}
