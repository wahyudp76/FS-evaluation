/** v1.9.0 — gantikan Tailwind Play CDN (render-blocking + JIT saat runtime)
 *  dengan CSS statis. Build lokal:
 *    npx tailwindcss -i ./assets/tailwind.input.css -o ./assets/tailwind.css --minify
 *  CI membangun ulang otomatis tiap deploy (lihat .github/workflows/deploy.yml).
 */
// Kelas warna kartu yang disusun dinamis di app.js (`bg-${c.color}-50`, dst.)
// tidak terlihat pemindai konten -> daftarkan eksplisit agar tidak hilang.
const _cardColors = ['amber', 'blue', 'emerald', 'red', 'rose', 'sky', 'slate', 'teal', 'violet'];
const _safelist = [];
_cardColors.forEach((c) => {
  _safelist.push(`bg-${c}-50`, `text-${c}-600`, `ring-${c}-100`, `ring-${c}-200/50`);
});

module.exports = {
  darkMode: 'class',
  content: ['./index.html', './app.js'],
  safelist: _safelist,
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        primary: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
        ink: { 50: '#f8fafc', 100: '#f1f5f9', 800: '#1e293b', 900: '#0f172a' },
      },
      boxShadow: {
        soft: '0 2px 20px -2px rgba(0,0,0,0.05), 0 1px 4px -1px rgba(0,0,0,0.03)',
        'soft-lg': '0 10px 40px -10px rgba(0,0,0,0.08), 0 4px 12px -4px rgba(0,0,0,0.05)',
      },
    },
  },
};
