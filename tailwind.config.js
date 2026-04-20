/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["System"],
      },
      boxShadow: {
        glass: "0 10px 30px rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
};
