import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { downloadFile, extractTarball, loadManifest } from './lib/integrity.mjs';

// OpenH264 is BSD-2-Clause, so linking it keeps this package permissively
// licensed (unlike GPL libx264). It builds with a plain Makefile (no configure).
const { openh264: dep } = loadManifest();
const OPENH264_VERSION = dep.version;

const root = join(import.meta.dirname, '..');
const depsDir = join(root, 'deps', 'openh264');

if (existsSync(join(depsDir, 'lib', 'libopenh264.a'))) {
  console.log('OpenH264 already built, skipping.');
  process.exit(0);
}

// validate version to prevent SSRF
if (!/^\d+\.\d+\.\d+$/.test(OPENH264_VERSION)) {
  console.error(`Invalid OpenH264 version: ${OPENH264_VERSION}`);
  process.exit(1);
}

if (process.platform === 'win32') {
  console.error(
    'On Windows, OpenH264 comes from vcpkg: run "node scripts/download-ffmpeg-windows.mjs".',
  );
  process.exit(1);
}

const tarball = join(root, `openh264-${OPENH264_VERSION}.tar.gz`);
const srcDir = join(root, `openh264-${OPENH264_VERSION}`);

// step 1: download (origin- and SHA-256-pinned via native-deps.json)
console.log(`Downloading OpenH264 ${OPENH264_VERSION}...`);
console.log(`URL: ${dep.url}`);

mkdirSync(join(root, 'deps'), { recursive: true });
await downloadFile(dep.url, tarball, { expectedSha256: dep.sha256, allowedOrigin: dep.origin });
console.log('Checksum verified. Extracting...');
extractTarball(tarball, root);
rmSync(tarball, { force: true });

// GitHub archive tarballs extract to `openh264-{tag}` — find it if the name differs
if (!existsSync(srcDir)) {
  const candidates = readdirSync(root).filter(
    (d) => d.startsWith('openh264-') && !d.endsWith('.tar.gz'),
  );
  const match = candidates.find((d) => d.includes(OPENH264_VERSION));
  if (match) {
    renameSync(join(root, match), srcDir);
    console.log(`Renamed ${match} → openh264-${OPENH264_VERSION}`);
  } else {
    console.error(
      `Could not find extracted OpenH264 source directory. Found: ${candidates.join(', ')}`,
    );
    process.exit(1);
  }
}

// OpenH264's Makefile auto-detects ARCH/OS from uname; allow overrides for
// cross-compilation (e.g. ARCH=x86_64 when building on an arm64 host).
const makeVars = [`PREFIX=${depsDir}`];
if (process.env.OPENH264_ARCH) makeVars.push(`ARCH=${process.env.OPENH264_ARCH}`);
if (process.env.OPENH264_OS) makeVars.push(`OS=${process.env.OPENH264_OS}`);

console.log('Building OpenH264...');
// bound parallelism to the core count (unbounded -j can exhaust process limits)
execFileSync('make', ['-j' + availableParallelism(), ...makeVars], {
  stdio: 'inherit',
  cwd: srcDir,
});

console.log('Installing static library...');
mkdirSync(join(depsDir, 'lib'), { recursive: true });
mkdirSync(join(depsDir, 'include'), { recursive: true });
// install-static writes libopenh264.a, the wels/*.h headers, and openh264.pc
execFileSync('make', ['install-static', ...makeVars], { stdio: 'inherit', cwd: srcDir });

rmSync(srcDir, { recursive: true, force: true });

console.log(`OpenH264 ${OPENH264_VERSION} installed to ${depsDir}`);
