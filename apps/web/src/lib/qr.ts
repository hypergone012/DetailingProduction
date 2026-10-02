import { encode } from 'uqr'

/**
 * QR code as one SVG path (dark modules as 1×1 squares, quiet zone included). Medium error
 * correction survives a printed code that is a bit worn or photographed at an angle.
 */
export function qrPath(text: string): { size: number; d: string } {
  const { data, size } = encode(text, { ecc: 'M', border: 4 })
  let d = ''
  data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)))
  return { size, d }
}

/** Standalone SVG document (always black on white: scanners need the contrast, whatever the theme). */
export function qrSvg(text: string): string {
  const { size, d } = qrPath(text)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

/** A printable PNG: the code plus the studio name and address under it. */
export async function qrPng(text: string, title: string): Promise<Blob> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text))}`
  await img.decode()
  const W = 1200
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 1420
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 100, 60, 1000, 1000)
  ctx.fillStyle = '#111'
  ctx.textAlign = 'center'
  const font = getComputedStyle(document.body).fontFamily
  ctx.font = `600 64px ${font}`
  ctx.fillText(title, W / 2, 1170, W - 120)
  ctx.font = `400 36px ${font}`
  ctx.fillStyle = '#444'
  ctx.fillText(text.replace(/^https?:\/\//, ''), W / 2, 1250, W - 120)
  ctx.font = `400 34px ${font}`
  ctx.fillText('Наведите камеру телефона, чтобы записаться', W / 2, 1330, W - 120)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'))
}
