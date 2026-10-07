const fs = require('fs');
const p = 'js/catatan.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// Pertahankan hanya model + helper (sampai renderCatatanChecklist).
const head = lines.slice(0, 436);
fs.writeFileSync(p, head.join('\n').replace(/\s+$/, '') + '\n', 'utf8');
console.log('baris tersisa:', head.length);
console.log('baris terakhir:', JSON.stringify(head[head.length - 1]));
// Deteksi karakter yang rusak encoding di bagian yang dipertahankan.
const bad = head.filter((l) => /[ï¿½âœ“â‹®]/.test(l));
console.log('baris rusak encoding:', bad.length);
bad.slice(0, 5).forEach((l) => console.log('  ', l));