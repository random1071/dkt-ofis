import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
const bubble = `<path d="M17 20.5c0-2.5 2-4.5 4.5-4.5h21c2.5 0 4.5 2 4.5 4.5v15c0 2.5-2 4.5-4.5 4.5H30l-7.2 6.3c-.8.7-2 .1-2-1V40h0.7c-2.5 0-4.5-2-4.5-4.5z" fill="#fbf4f0"/>
<path d="M25.5 25.6c1.1 1.4 1.1 3.4 0 4.8M30 22.6c2.6 3.2 2.6 7.6 0 10.8M34.6 19.6c4 4.9 4 11.9 0 16.8" fill="none" stroke="#a46e6b" stroke-width="2.3" stroke-linecap="round" transform="translate(1.5 -0.5)"/>`;
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c09391"/><stop offset="1" stop-color="#93605e"/></linearGradient></defs>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" rx="14" fill="url(#g)"/>${bubble}</svg>`;
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" fill="url(#g)"/>${bubble}</svg>`;
// maskable: içerik güvenli alanda (%80)
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(6.4 6.4) scale(0.8)">${bubble}</g></svg>`;
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', rounded);
await sharp(Buffer.from(rounded)).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(rounded)).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');
await sharp(Buffer.from(full)).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(rounded)).resize(32, 32).png().toFile('public/icons/favicon-32.png');
console.log('ikonlar hazır');
