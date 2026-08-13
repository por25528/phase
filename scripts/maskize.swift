#!/usr/bin/env swift
// Post-process a rasterized SVG render into a macOS template mask.
//
// qlmanage paints the SVG's document page opaque white with the black glyph on
// top, so a straight resize keeps alpha = 255 on every pixel and Electron's
// setTemplateImage(true) renders a filled square in the menu bar. This tool
// turns that opaque white/black silhouette into a real template mask: every
// pixel's RGB becomes neutral black and alpha becomes the inverse luminance,
// so the white page -> transparent, the black glyph -> opaque, and the
// antialiased edge becomes fractional alpha. It is strict on purpose: it exits
// non-zero on any degenerate input or output so a broken render can never be
// committed silently.
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
guard width == expectedWidth, height == expectedHeight else {
    fail("\(inputPath) is \(width)x\(height), expected \(expectedWidth)x\(expectedHeight)", code: 67)
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

var transparent = 0
var visible = 0
for y in 0..<height {
    let row = y * bytesPerRow
    for x in 0..<width {
        let o = row + x * 4
        let a = 255 - luminance(Int(pixels[o]), Int(pixels[o + 1]), Int(pixels[o + 2]))
        pixels[o] = 0
        pixels[o + 1] = 0
        pixels[o + 2] = 0
        pixels[o + 3] = UInt8(a)
        if a == 0 {
            transparent += 1
        } else {
            visible += 1
        }
    }
}

// Fail loudly on a degenerate mask: qlmanage drawing no glyph (all white ->
// nothing visible) or no page (all black -> nothing transparent) would both
// produce an icon worth zero pixels.
guard transparent > 0, visible > 0 else {
    fail("\(inputPath) produced \(visible) visible and \(transparent) transparent pixels; refusing to write a degenerate mask", code: 71)
}

guard let destination = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: outputPath) as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
) else {
    fail("cannot create \(outputPath)", code: 72)
}

guard let outContext = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("cannot allocate output context", code: 70)
}
guard let outImage = outContext.makeImage() else {
    fail("cannot make output image", code: 73)
}
CGImageDestinationAddImage(destination, outImage, nil)
guard CGImageDestinationFinalize(destination) else {
    fail("cannot write \(outputPath)", code: 74)
}
