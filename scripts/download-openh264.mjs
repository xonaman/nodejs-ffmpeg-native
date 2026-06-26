import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// OpenH264 is BSD-2-Clause, so linking it keeps this package permissively
// licensed (unlike GPL libx264). It builds with a plain Makefile (no configure).
const OPENH264_VERSION = process.env.OPENH264_VERSION || '2.4.1';
const BASE_URL = 'https://github.com/cisco/openh264/archive/refs/tags';

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
  console.error('OpenH264 source build is not supported on Windows in this package.');
  process.exit(1);
}

const url = `${BASE_URL}/v${OPENH264_VERSION}.tar.gz`;
const tarball = join(root, `openh264-${OPENH264_VERSION}.tar.gz`);
const srcDir = join(root, `openh264-${OPENH264_VERSION}`);

console.log(`Downloading OpenH264 ${OPENH264_VERSION}...`);
console.log(`URL: ${url}`);

const response = await fetch(url, { redirect: 'follow' });
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

mkdirSync(join(root, 'deps'), { recursive: true });
await pipeline(Readable.fromWeb(response.body), createWriteStream(tarball));

console.log('Extracting...');
execFileSync('tar', ['-xzf', tarball, '-C', root], { stdio: 'inherit' });
rmSync(tarball);

// OpenH264's Makefile auto-detects ARCH/OS from uname; allow overrides for
// cross-compilation (e.g. ARCH=x86_64 when building on an arm64 host).
const makeVars = [`PREFIX=${depsDir}`];
if (process.env.OPENH264_ARCH) makeVars.push(`ARCH=${process.env.OPENH264_ARCH}`);
if (process.env.OPENH264_OS) makeVars.push(`OS=${process.env.OPENH264_OS}`);

console.log('Building OpenH264...');
execFileSync('make', ['-j', ...makeVars], { stdio: 'inherit', cwd: srcDir });

console.log('Installing static library...');
mkdirSync(join(depsDir, 'lib'), { recursive: true });
mkdirSync(join(depsDir, 'include'), { recursive: true });
// install-static writes libopenh264.a, the wels/*.h headers, and openh264.pc
execFileSync('make', ['install-static', ...makeVars], { stdio: 'inherit', cwd: srcDir });

rmSync(srcDir, { recursive: true, force: true });

console.log(`OpenH264 ${OPENH264_VERSION} installed to ${depsDir}`);
