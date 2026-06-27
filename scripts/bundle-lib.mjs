import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// FFmpeg and OpenH264 are statically linked into ffmpeg.node, so there is no
// shared library to copy — we only strip debug symbols to shrink the binary.
const root = join(import.meta.dirname, '..');
const outDir = join(root, 'build', 'Release');
const nodeFile = join(outDir, 'ffmpeg.node');

if (!existsSync(nodeFile)) {
  console.error('ffmpeg.node not found — run node-gyp rebuild first');
  process.exit(1);
}

/** Strip debug symbols from a binary. */
function strip(file) {
  if (process.platform === 'darwin') {
    // macOS strip can corrupt .node binaries — skip
    console.log('Skipping strip on macOS (known compatibility issue).');
    return;
  }
  if (process.platform === 'win32') {
    // MSVC handles stripping via the Release config; no strip on Windows.
    console.log('Skipping strip on Windows (handled by MSVC linker).');
    return;
  }
  try {
    execFileSync('strip', ['-s', file], { stdio: 'inherit' });
    console.log(`Stripped ${file.split('/').pop()}`);
  } catch {
    console.warn(`strip failed for ${file.split('/').pop()} — continuing`);
  }
}

strip(nodeFile);
console.log('Bundle complete.');
