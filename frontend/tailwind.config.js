/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      typography: {
        invert: {
          css: {
            "--tw-prose-body": "#d1d5db",
            "--tw-prose-headings": "#f9fafb",
            "--tw-prose-lead": "#9ca3af",
            "--tw-prose-links": "#818cf8",
            "--tw-prose-bold": "#f9fafb",
            "--tw-prose-counters": "#6b7280",
            "--tw-prose-bullets": "#4b5563",
            "--tw-prose-hr": "#374151",
            "--tw-prose-quotes": "#9ca3af",
            "--tw-prose-quote-borders": "#374151",
            "--tw-prose-captions": "#6b7280",
            "--tw-prose-code": "#6ee7b7",
            "--tw-prose-pre-code": "#d1d5db",
            "--tw-prose-pre-bg": "#1f2937",
            "--tw-prose-th-borders": "#374151",
            "--tw-prose-td-borders": "#1f2937",
          },
        },
      },
    },
  },
  plugins: [],
};
