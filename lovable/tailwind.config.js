/** Tailwind is here for code written inside Lovable from now on.
 *  The ported Gantt page uses the --ios-* custom properties in src/index.css
 *  and does not depend on Tailwind at all — the two coexist. */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
