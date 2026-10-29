import { build } from 'esbuild';
await build({ entryPoints: ['src/dashboard.js'], bundle: true, outfile: 'dist/app.js', format: 'iife', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'eof', sourcemap: false });
console.log('Teamflow client bundled. No secret or service-role key is included.');
