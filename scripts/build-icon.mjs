// The desktop app's icon: the island itself, drawn from the same geometry the
// game is played on, so the two can never drift apart.
//
//   node scripts/build-icon.mjs   →  icon-source.svg
//   npx tauri icon icon-source.svg
//
// The SVG is not committed: it is six hundred kilobytes of coastline that this
// script reproduces exactly.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('src/engine/mapData.generated.ts', 'utf8');

// The generated file stores geometry as JSON-ish object literals.
const paths = [...src.matchAll(/"path":\s*"([^"]+)"/g)].map((m) => m[1]);
const bounds = src.match(/MAP_BOUNDS\s*=\s*\{([^}]+)\}/s)[1];
const num = (key) => Number(bounds.match(new RegExp(`${key}:\\s*([0-9.]+)`))[1]);
const minX = num('minX');
const minY = num('minY');
const maxX = num('maxX');
const maxY = num('maxY');

const w = maxX - minX;
const h = maxY - minY;

// Fit the island into a 1024 box with room to breathe, keeping its proportions.
const SIZE = 1024;
const PAD = 118;
const scale = Math.min((SIZE - PAD * 2) / w, (SIZE - PAD * 2) / h);
const tx = (SIZE - w * scale) / 2 - minX * scale;
const ty = (SIZE - h * scale) / 2 - minY * scale;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2431"/>
      <stop offset="1" stop-color="#0c1017"/>
    </linearGradient>
    <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fb2ff"/>
      <stop offset="1" stop-color="#3f7ae0"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="196" fill="url(#ground)"/>
  <rect x="8" y="8" width="${SIZE - 16}" height="${SIZE - 16}" rx="190" fill="none"
        stroke="#4f8ef7" stroke-opacity="0.28" stroke-width="10"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})"
     fill="url(#land)" stroke="#0c1017" stroke-width="${(1.6 / scale).toFixed(3)}"
     stroke-linejoin="round">
${paths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>`;

writeFileSync('icon-source.svg', svg);
console.log('regions:', paths.length, 'svg bytes:', svg.length);
