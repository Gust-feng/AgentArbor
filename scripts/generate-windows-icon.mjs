import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const publicDirectory = join(process.cwd(), "src", "app", "panel-ui", "public");
const output = join(publicDirectory, "favicon.ico");
const sizes = [32, 64, 128, 256];

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, createIco(sizes.map((size) => ({
  size,
  body: readFileSync(join(publicDirectory, `favicon-${size}.png`)),
}))));

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const buffer = Buffer.alloc(headerSize + images.reduce((total, image) => total + image.body.length, 0));
  let offset = 0;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(images.length, offset);
  offset += 2;
  let imageOffset = headerSize;
  for (let index = 0; index < images.length; index += 1) {
    const { size, body } = images[index];
    buffer[offset] = size === 256 ? 0 : size;
    buffer[offset + 1] = size === 256 ? 0 : size;
    buffer[offset + 2] = 0;
    buffer[offset + 3] = 0;
    buffer.writeUInt16LE(1, offset + 4);
    buffer.writeUInt16LE(32, offset + 6);
    buffer.writeUInt32LE(body.length, offset + 8);
    buffer.writeUInt32LE(imageOffset, offset + 12);
    offset += 16;
    body.copy(buffer, imageOffset);
    imageOffset += body.length;
  }
  return buffer;
}
