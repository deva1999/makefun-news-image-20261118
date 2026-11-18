// makefun-news-image-20261118 — variant 1
//
// Copies the bundled front-page image (entry.png, in this same directory)
// to the grader's output location: /output/entry.png, or the directory named
// by $MAKEFUN_OUTPUT_DIR when it is set.
//
// Gate checks, all before anything is written:
//   - the source is a PNG (8-byte signature)
//   - its IHDR dimensions are at most 1024 x 1024
//   - the file is at most 1 MiB
// The write itself is atomic (temp file in the same directory, then rename),
// and the SHA-256 of the written file must match the source byte for byte.
// Any failure aborts loudly with a non-zero exit and no partial output.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_BYTES = 1024 * 1024;
const MAX_WIDTH = 1024;
const MAX_HEIGHT = 1024;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// Read a big-endian unsigned 32-bit integer out of a buffer.
function readU32BE(buf, offset) {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  ) >>> 0;
}

// Parse width and height out of a PNG's IHDR chunk. The IHDR chunk sits
// right after the 8-byte signature: 4 bytes length, 4 bytes type ("IHDR"),
// then 4 bytes width and 4 bytes height, both big-endian.
function pngDimensions(buf) {
  if (buf.length < 8 + 8 + 8) {
    fail("PNG too short to hold an IHDR chunk");
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("source is not a PNG (bad signature)");
  }
  const type = buf.subarray(12, 16).toString("ascii");
  if (type !== "IHDR") {
    fail(`first PNG chunk is ${type}, expected IHDR`);
  }
  return { width: readU32BE(buf, 16), height: readU32BE(buf, 20) };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = resolve(here, "entry.png");
  if (!existsSync(sourcePath)) {
    fail(`bundled image not found: ${sourcePath}`);
  }
  if (!statSync(sourcePath).isFile()) {
    fail(`bundled image is not a regular file: ${sourcePath}`);
  }

  const source = readFileSync(sourcePath);
  const { width, height } = pngDimensions(source);
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    fail(
      `image is ${width}x${height}, over the ${MAX_WIDTH}x${MAX_HEIGHT} cap`,
    );
  }
  if (source.length > MAX_BYTES) {
    fail(`image is ${source.length} bytes, over the ${MAX_BYTES} byte cap`);
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");

  // Atomic write: stage beside the destination, then rename over it, so a
  // reader never sees a half-written file.
  const tmpPath = join(outDir, `.entry.png.tmp-${process.pid}`);
  try {
    writeFileSync(tmpPath, source);
    renameSync(tmpPath, outPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best effort cleanup; the original error is what matters
    }
    fail(`could not write ${outPath}: ${err.message}`);
  }

  // Verify the written bytes are exactly the source bytes.
  const written = readFileSync(outPath);
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  if (hash(written) !== hash(source)) {
    fail("SHA-256 of the written file does not match the source");
  }
  if (written.length !== source.length) {
    fail(
      `written file is ${written.length} bytes, source is ${source.length}`,
    );
  }

  console.log(
    `wrote ${outPath} (${width}x${height}, ${written.length} bytes, ` +
      `sha256 ${hash(written)})`,
  );
}

main();
