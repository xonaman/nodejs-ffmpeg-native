/**
 * Builds FFmpeg + OpenH264 for Windows via vcpkg and copies the static libs and
 * headers into deps/ so binding.gyp's OS=='win' branch can link them.
 *
 * Unlike macOS/Linux (which build FFmpeg n7.1.1 from source with a curated
 * --disable-everything allowlist), Windows uses vcpkg's stock FFmpeg port: a
 * newer FFmpeg (8.x) with a larger but functionally-superset codec set. It stays
 * LGPL — no gpl/nonfree features — with H.264 encode via OpenH264 (BSD), exactly
 * like the other platforms.
 *
 * The port version + feature set are pinned in vcpkg.json (manifest mode with a
 * builtin-baseline), so the resulting FFmpeg is reproducible rather than
 * floating with whatever baseline the runner's vcpkg happens to ship.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const ffmpegDir = join(root, 'deps', 'ffmpeg');
const openh264Dir = join(root, 'deps', 'openh264');

if (process.platform !== 'win32') {
  console.error('download-ffmpeg-windows.mjs is Windows-only; use download-ffmpeg.mjs elsewhere.');
  process.exit(1);
}

if (existsSync(join(ffmpegDir, 'lib', 'avcodec.lib'))) {
  console.log('FFmpeg (Windows) already built, skipping.');
  process.exit(0);
}

const triplet = process.env.VCPKG_TARGET_TRIPLET || `${process.arch}-windows-static`;
const vcpkgRoot = process.env.VCPKG_ROOT || 'C:\\vcpkg';
const vcpkgExe = join(vcpkgRoot, 'vcpkg.exe');

if (!existsSync(vcpkgExe)) {
  console.error(`vcpkg not found at ${vcpkgExe}. Set VCPKG_ROOT to your vcpkg install.`);
  process.exit(1);
}

// LGPL build: avcodec/avformat/avutil/swscale/swresample + the OpenH264 (BSD)
// H.264 encoder + zlib (png/mov). The feature set (with default features off, so
// the avdevice/avfilter defaults we never use are dropped) and the pinned
// version live in vcpkg.json; no gpl/nonfree features keeps it LGPL like the
// source builds. Manifest mode installs into ./vcpkg_installed instead of the
// vcpkg root's shared tree.
const installRoot = join(root, 'vcpkg_installed');

console.log(`Installing FFmpeg via vcpkg (manifest mode, triplet ${triplet})...`);
execFileSync(
  vcpkgExe,
  [
    'install',
    `--triplet=${triplet}`,
    `--x-manifest-root=${root}`,
    `--x-install-root=${installRoot}`,
    '--clean-after-build',
  ],
  { stdio: 'inherit', cwd: root },
);

const installed = join(installRoot, triplet);
const libSrc = join(installed, 'lib');
const incSrc = join(installed, 'include');
if (!existsSync(libSrc)) {
  console.error(`vcpkg install dir not found: ${libSrc}`);
  process.exit(1);
}

mkdirSync(join(ffmpegDir, 'lib'), { recursive: true });
mkdirSync(join(ffmpegDir, 'include'), { recursive: true });
mkdirSync(join(openh264Dir, 'lib'), { recursive: true });

// the FFmpeg static libs + headers binding.gyp links and includes
for (const lib of ['avcodec.lib', 'avformat.lib', 'avutil.lib', 'swscale.lib', 'swresample.lib']) {
  cpSync(join(libSrc, lib), join(ffmpegDir, 'lib', lib));
  console.log(`Copied ${lib}`);
}
cpSync(incSrc, join(ffmpegDir, 'include'), { recursive: true });

// OpenH264 installs as openh264.lib; binding.gyp links it from deps/openh264/lib.
cpSync(join(libSrc, 'openh264.lib'), join(openh264Dir, 'lib', 'openh264.lib'));
console.log('Copied openh264.lib');

// vcpkg's static zlib lib name varies by version (zlib.lib / zs.lib /
// zlibstatic.lib); copy whichever exists to the zlib.lib name binding.gyp links.
const zlibSrc = ['zlib.lib', 'zs.lib', 'zlibstatic.lib']
  .map((n) => join(libSrc, n))
  .find((p) => existsSync(p));
if (!zlibSrc) {
  console.error(`zlib static lib not found in ${libSrc}. Contents:`, readdirSync(libSrc));
  process.exit(1);
}
cpSync(zlibSrc, join(ffmpegDir, 'lib', 'zlib.lib'));
console.log(`Copied ${zlibSrc} -> deps/ffmpeg/lib/zlib.lib`);

console.log(`FFmpeg (Windows, ${triplet}) installed to ${ffmpegDir}`);
