import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const output = join(process.cwd(), "src", "app", "panel-ui", "public", "favicon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, createIco(sizes));

function createIco(iconSizes) {
  const images = iconSizes.map((size) => createDibIcon(size));
  const headerSize = 6 + images.length * 16;
  const buffer = Buffer.alloc(headerSize + images.reduce((total, image) => total + image.length, 0));
  let offset = 0;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(images.length, offset);
  offset += 2;
  let imageOffset = headerSize;
  for (let index = 0; index < images.length; index += 1) {
    const size = iconSizes[index];
    const image = images[index];
    buffer[offset] = size === 256 ? 0 : size;
    buffer[offset + 1] = size === 256 ? 0 : size;
    buffer[offset + 2] = 0;
    buffer[offset + 3] = 0;
    buffer.writeUInt16LE(1, offset + 4);
    buffer.writeUInt16LE(32, offset + 6);
    buffer.writeUInt32LE(image.length, offset + 8);
    buffer.writeUInt32LE(imageOffset, offset + 12);
    offset += 16;
    image.copy(buffer, imageOffset);
    imageOffset += image.length;
  }
  return buffer;
}

function createDibIcon(size) {
  const pixels = renderIconPixels(size);
  const xorStride = size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const headerSize = 40;
  const xorSize = xorStride * size;
  const andSize = andStride * size;
  const dib = Buffer.alloc(headerSize + xorSize + andSize);
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(xorSize + andSize, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);

  let offset = headerSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = pixels[y * size + x];
      dib[offset] = pixel.b;
      dib[offset + 1] = pixel.g;
      dib[offset + 2] = pixel.r;
      dib[offset + 3] = pixel.a;
      offset += 4;
    }
  }
  return dib;
}

function renderIconPixels(size) {
  const scale = size >= 64 ? 4 : size >= 32 ? 3 : 2;
  const pixels = new Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[y * size + x] = samplePixel(x, y, size, scale);
    }
  }
  return pixels;
}

function samplePixel(x, y, size, scale) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let sy = 0; sy < scale; sy += 1) {
    for (let sx = 0; sx < scale; sx += 1) {
      const sample = drawAt((x + (sx + 0.5) / scale) / size, (y + (sy + 0.5) / scale) / size);
      const alpha = sample.a / 255;
      r += sample.r * alpha;
      g += sample.g * alpha;
      b += sample.b * alpha;
      a += alpha;
    }
  }
  const total = scale * scale;
  if (a <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: Math.round(r / a),
    g: Math.round(g / a),
    b: Math.round(b / a),
    a: Math.round((a / total) * 255),
  };
}

function drawAt(x, y) {
  const centerX = 0.508;
  const centerY = 0.508;
  const dx = x - centerX;
  const dy = y - centerY;
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const arcVisible = angle >= -Math.PI / 2 || angle <= -Math.PI;
  const stroke = 0.032;
  const shadowStroke = 0.055;
  const rings = [0.35, 0.245, 0.142];
  let color = transparent();

  for (const ring of rings) {
    color = over(color, ringStroke(radius, ring, shadowStroke, arcVisible, { r: 101, g: 122, b: 130, a: 70 }));
    color = over(color, ringStroke(radius, ring, stroke, arcVisible, { r: 184, g: 202, b: 205, a: 230 }));
    color = over(color, ringStroke(radius, ring, 0.018, arcVisible, { r: 249, g: 254, b: 254, a: 230 }));
    color = over(color, ringStroke(radius, ring - 0.015, 0.006, arcVisible, { r: 255, g: 255, b: 255, a: 150 }));
  }

  const verticalDistance = Math.abs(x - centerX);
  const verticalVisible = y >= 0.155 && y <= centerY;
  color = over(color, lineStroke(verticalDistance, shadowStroke, verticalVisible, { r: 101, g: 122, b: 130, a: 70 }));
  color = over(color, lineStroke(verticalDistance, stroke, verticalVisible, { r: 184, g: 202, b: 205, a: 230 }));
  color = over(color, lineStroke(verticalDistance, 0.018, verticalVisible, { r: 249, g: 254, b: 254, a: 230 }));

  color = over(color, circleFill(radius, 0.046, { r: 101, g: 122, b: 130, a: 74 }));
  color = over(color, circleFill(radius, 0.039, { r: 184, g: 202, b: 205, a: 230 }));
  color = over(color, circleFill(radius, 0.033, { r: 250, g: 254, b: 254, a: 245 }));
  return color;
}

function ringStroke(radius, target, width, visible, color) {
  if (!visible) return transparent();
  const distance = Math.abs(radius - target);
  return fadeStroke(distance, width, color);
}

function lineStroke(distance, width, visible, color) {
  if (!visible) return transparent();
  return fadeStroke(distance, width, color);
}

function circleFill(radius, target, color) {
  const edge = 0.006;
  const coverage = clamp((target + edge - radius) / (edge * 2), 0, 1);
  return { ...color, a: Math.round(color.a * coverage) };
}

function fadeStroke(distance, width, color) {
  const half = width / 2;
  const edge = width * 0.22;
  const coverage = clamp((half + edge - distance) / edge, 0, 1);
  return { ...color, a: Math.round(color.a * coverage) };
}

function over(bottom, top) {
  if (top.a <= 0) return bottom;
  if (bottom.a <= 0) return top;
  const topAlpha = top.a / 255;
  const bottomAlpha = bottom.a / 255;
  const outAlpha = topAlpha + bottomAlpha * (1 - topAlpha);
  return {
    r: Math.round((top.r * topAlpha + bottom.r * bottomAlpha * (1 - topAlpha)) / outAlpha),
    g: Math.round((top.g * topAlpha + bottom.g * bottomAlpha * (1 - topAlpha)) / outAlpha),
    b: Math.round((top.b * topAlpha + bottom.b * bottomAlpha * (1 - topAlpha)) / outAlpha),
    a: Math.round(outAlpha * 255),
  };
}

function transparent() {
  return { r: 0, g: 0, b: 0, a: 0 };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
