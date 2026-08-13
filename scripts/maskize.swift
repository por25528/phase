#!/usr/bin/env swift
// Post-process a rasterized SVG render into a macOS template mask.
//
// qlmanage paints the SVG's document page opaque white with the black glyph on
// top, but its thumbnail raster is degenerate: whatever -s is requested, the
// glyph is rendered at only a few pixels in the top-left corner of the page.
// A straight resize keeps that tiny blob (alpha = 255 on every page pixel, and
// a glyph that is a handful of pixels), so Electron's setTemplateImage(true)
// renders an almost-empty icon. This tool turns that opaque white/black
// silhouette into a real template mask with a usable glyph: it discovers the
// non-white content bounds, crops to them, scales the crop aspect-fit into the
// requested target with quiet even padding, and converts inverse luminance to
// neutral-black alpha. The antialiased edge becomes fractional alpha. It is
// strict on purpose: it exits non-zero on any degenerate input or output so a
// broken render can never be committed silently.
//
// Usage: maskize <input.png> <output.png> <width> <height>

import Foundation
import ImageIO
import UniformTypeIdentifiers

func luminance(_ r: Int, _ g: Int, _ b: Int) -> Int {
    Int((0.299 * Double(r) + 0.587 * Double(g) + 0.114 * Double(b)).rounded())
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("maskize: \(message)\n".utf8))
    exit(code)
}

let args = CommandLine.arguments
guard args.count == 5 else {
    fail("usage: maskize <input.png> <output.png> <width> <height>", code: 64)
}
let inputPath = args[1]
let outputPath = args[2]
guard let expectedWidth = Int(args[3]), let expectedHeight = Int(args[4]) else {
    fail("invalid expected size \(args[3])x\(args[4])", code: 64)
}

guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: inputPath) as CFURL, nil) else {
    fail("cannot open \(inputPath)", code: 65)
}
guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("cannot decode \(inputPath)", code: 65)
}
let width = image.width
let height = image.height
guard width > 0, height > 0 else {
    fail("\(inputPath) is empty", code: 67)
}
guard image.alphaInfo != .none, image.bitsPerComponent == 8 else {
    fail("\(inputPath) is not 8-bit RGBA; a template mask needs an alpha channel", code: 68)
}

let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("cannot allocate a \(width)x\(height) drawing context", code: 70)
}

// CGBitmapContext memory is bottom-up in device space, so an unflipped draw
// places the image's top row at the top of the buffer. Drawing without any
// transform keeps buffer row 0 = rendered top row.
context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

// Discover the glyph's non-white content bounds. The page is painted near-white
// (luminance ~255) and the glyph is black, so "content" is any pixel darker
// than a generous threshold. Transparent pixels (outside the page) never count.
let whiteThreshold = 250
var minX = width
var minY = height
var maxX = -1
var maxY = -1
for y in 0..<height {
    let row = y * bytesPerRow
    for x in 0..<width {
        let o = row + x * 4
        if pixels[o + 3] > 0 && luminance(Int(pixels[o]), Int(pixels[o + 1]), Int(pixels[o + 2])) < whiteThreshold {
            if x < minX { minX = x }
            if x > maxX { maxX = x }
            if y < minY { minY = y }
            if y > maxY { maxY = y }
        }
    }
}
guard minX <= maxX, minY <= maxY else {
    fail("\(inputPath) contains no glyph content; refusing to write an empty mask", code: 71)
}
let contentWidth = maxX - minX + 1
let contentHeight = maxY - minY + 1

// Build an alpha mask over just the content crop: RGB becomes neutral black and
// alpha becomes inverse luminance, so the white page around the glyph is
// transparent and the antialiased edge carries fractional alpha.
var mask = [UInt8](repeating: 0, count: contentHeight * contentWidth * 4)
for y in 0..<contentHeight {
    let srcRow = (minY + y) * bytesPerRow + minX * 4
    let dstRow = y * contentWidth * 4
    for x in 0..<contentWidth {
        let so = srcRow + x * 4
        let do_ = dstRow + x * 4
        let a = 255 - luminance(Int(pixels[so]), Int(pixels[so + 1]), Int(pixels[so + 2]))
        mask[do_] = 0
        mask[do_ + 1] = 0
        mask[do_ + 2] = 0
        mask[do_ + 3] = UInt8(a)
    }
}

// Scale the cropped mask aspect-fit into the target with quiet even padding:
// the glyph fills most of the canvas but clears every edge, so it reads as a
// centered icon rather than a corner clip or a full bleed.
let padFactor = 0.82
let scale = padFactor * min(
    Double(expectedWidth) / Double(contentWidth),
    Double(expectedHeight) / Double(contentHeight)
)
let drawWidth = max(1, Int((Double(contentWidth) * scale).rounded()))
let drawHeight = max(1, Int((Double(contentHeight) * scale).rounded()))
let offsetX = (expectedWidth - drawWidth) / 2
let offsetY = (expectedHeight - drawHeight) / 2

let maskData = Data(mask) as CFData
guard let provider = CGDataProvider(data: maskData) else {
    fail("cannot build the mask image from \(inputPath)", code: 72)
}
guard let maskImage = CGImage(
    width: contentWidth,
    height: contentHeight,
    bitsPerComponent: 8,
    bitsPerPixel: 32,
    bytesPerRow: contentWidth * 4,
    space: colorSpace,
    bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
    provider: provider,
    decode: nil,
    shouldInterpolate: true,
    intent: .defaultIntent
) else {
    fail("cannot build the mask image from \(inputPath)", code: 72)
}

var outPixels = [UInt8](repeating: 0, count: expectedHeight * expectedWidth * 4)
guard let outContext = CGContext(
    data: &outPixels,
    width: expectedWidth,
    height: expectedHeight,
    bitsPerComponent: 8,
    bytesPerRow: expectedWidth * 4,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("cannot allocate a \(expectedWidth)x\(expectedHeight) output context", code: 70)
}
outContext.interpolationQuality = .high
outContext.draw(maskImage, in: CGRect(x: offsetX, y: offsetY, width: drawWidth, height: drawHeight))

var transparent = 0
var visible = 0
for y in 0..<expectedHeight {
    let row = y * expectedWidth * 4
    for x in 0..<expectedWidth {
        let o = row + x * 4
        // Neutral black RGB; the shape lives entirely in the alpha channel.
        outPixels[o] = 0
        outPixels[o + 1] = 0
        outPixels[o + 2] = 0
        if outPixels[o + 3] == 0 {
            transparent += 1
        } else {
            visible += 1
        }
    }
}

// Fail loudly on a degenerate mask: qlmanage drawing no glyph (all white ->
// nothing visible) or no page (all black -> nothing transparent) would both
// produce an icon worth zero pixels. The glyph must also actually fill the
// canvas, or the crop/scale above quietly produced a corner dot.
guard transparent > 0, visible > 0 else {
    fail("\(inputPath) produced \(visible) visible and \(transparent) transparent pixels; refusing to write a degenerate mask", code: 71)
}
guard Double(visible) > 0.1 * Double(expectedWidth * expectedHeight) else {
    fail("\(inputPath) produced only \(visible) visible pixels; refusing to write a dot for a glyph", code: 71)
}

guard let destination = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: outputPath) as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
) else {
    fail("cannot create \(outputPath)", code: 73)
}

guard let outContext2 = CGContext(
    data: &outPixels,
    width: expectedWidth,
    height: expectedHeight,
    bitsPerComponent: 8,
    bytesPerRow: expectedWidth * 4,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("cannot allocate output context", code: 70)
}
guard let outImage = outContext2.makeImage() else {
    fail("cannot make output image", code: 74)
}
CGImageDestinationAddImage(destination, outImage, nil)
guard CGImageDestinationFinalize(destination) else {
    fail("cannot write \(outputPath)", code: 75)
}
