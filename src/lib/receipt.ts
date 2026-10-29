export type ReceiptProduct = {
  id: string
  name: string
  quantity: number
}

function normalizeReceiptLine(line: string) {
  return line.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr')
}

function cleanReceiptProductName(line: string) {
  return line
    .replace(/^\s*(?:\d{1,2}|[a-z])\s*[x×]\s*/i, '')
    .replace(/\d+(?:[.,]\d+)?/g, (number, offset: number, source: string) => {
      const followingText = source.slice(offset + number.length)
      return /^\s*(?:mg|kg|g|ml|cl|dl|l)\b/i.test(followingText) ? number : ''
    })
    .replace(/[€%]/g, '')
    .replace(/^[\s*•|:;._-]+|[\s*•|:;._-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/[.,]+(?=\s|$)/g, '')
    .trim()
}

function parseSingleReceiptText(text: string): Omit<ReceiptProduct, 'id'>[] {
  const products = new Map<string, Omit<ReceiptProduct, 'id'>>()

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, ' ').trim()
    const leadingQuantity = /^(\d{1,2})(?:[,.]0+)?\s*[xX×]\s*(.+)$/.exec(line)
    const noisyQuantityPrefix = /^(?:[a-z]{1,2}|\d{1,2})\s*[x×]\s*(.+)$/i.exec(line)
    const name = cleanReceiptProductName(leadingQuantity?.[2] ?? noisyQuantityPrefix?.[1] ?? line)
    if (name.length < 3 || name.length > 120 || !/[a-zà-ÿ]{2}/i.test(name)) continue

    const key = normalizeReceiptLine(name).replace(/[^\p{L}\p{N}]+/gu, '')
    const existing = products.get(key)
    const quantity = leadingQuantity ? Number(leadingQuantity[1].replace(',', '.')) : 1
    products.set(key, { name, quantity: (existing?.quantity ?? 0) + (quantity > 0 ? quantity : 1) })
  }

  return [...products.values()]
}

export function parseReceiptText(text: string | string[]): Omit<ReceiptProduct, 'id'>[] {
  const products = new Map<string, Omit<ReceiptProduct, 'id'>>()
  for (const candidate of (Array.isArray(text) ? text : [text]).flatMap(parseSingleReceiptText)) {
    const key = normalizeReceiptLine(candidate.name).replace(/[^\p{L}\p{N}]+/gu, '')
    const matchingKey = [...products.keys()].find((existingKey) =>
      existingKey === key
      || (Math.min(existingKey.length, key.length) >= 7
        && Math.abs(existingKey.length - key.length) <= 2
        && (existingKey.startsWith(key) || key.startsWith(existingKey))),
    )
    const existing = matchingKey ? products.get(matchingKey) : undefined
    products.set(matchingKey ?? key, existing
      ? { name: candidate.name.length > existing.name.length ? candidate.name : existing.name, quantity: Math.max(existing.quantity, candidate.quantity) }
      : candidate)
  }
  return [...products.values()]
}

export async function prepareReceiptImage(file: File): Promise<Blob> {
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(2400 / image.width, Math.max(1, 1800 / image.width))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Impossible de préparer la photo du ticket.')

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114
      const contrast = Math.max(0, Math.min(255, (gray - 150) * 1.35 + 150))
      pixels.data[index] = contrast
      pixels.data[index + 1] = contrast
      pixels.data[index + 2] = contrast
    }
    context.putImageData(pixels, 0, 0)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Impossible de préparer la photo du ticket.'))
      }, 'image/png')
    })
  } finally {
    image.close()
  }
}
