import { describe, expect, it } from 'vitest';
import { scaledDimensions } from './imageScale';

function expectValidDimensions(width: number, height: number): void {
  expect(Number.isInteger(width)).toBe(true);
  expect(Number.isInteger(height)).toBe(true);
  expect(width).toBeGreaterThanOrEqual(1);
  expect(height).toBeGreaterThanOrEqual(1);
}

describe('scaledDimensions', () => {
  it('scales a landscape image by its long edge', () => {
    const result = scaledDimensions(4000, 2000, 2000);

    expect(result).toEqual({ width: 2000, height: 1000 });
    expectValidDimensions(result.width, result.height);
  });

  it('scales a portrait image by its long edge', () => {
    const result = scaledDimensions(1000, 4000, 2000);

    expect(result).toEqual({ width: 500, height: 2000 });
    expectValidDimensions(result.width, result.height);
  });

  it('scales a square image evenly', () => {
    const result = scaledDimensions(3000, 3000, 2000);

    expect(result).toEqual({ width: 2000, height: 2000 });
    expectValidDimensions(result.width, result.height);
  });

  it('does not upscale an already-small image', () => {
    expect(scaledDimensions(640, 480, 2000)).toEqual({ width: 640, height: 480 });
  });

  it('keeps an image at exactly the limit unchanged', () => {
    expect(scaledDimensions(2000, 1200, 2000)).toEqual({ width: 2000, height: 1200 });
  });

  it('preserves aspect ratio to within rounding', () => {
    const sourceWidth = 4032;
    const sourceHeight = 3024;
    const result = scaledDimensions(sourceWidth, sourceHeight, 2000);

    expect(Math.abs(result.width / result.height - sourceWidth / sourceHeight)).toBeLessThan(0.001);
    expectValidDimensions(result.width, result.height);
  });
});
