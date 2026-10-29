export type ReceiptProduct = {
  id: string
  name: string
  quantity: number
}

const excludedReceiptLine = /^(?:(?:\d{1,2}\s+)?(?:ticket|caisse|sous.?total|total|totaux|tva|rendu|monnaie|paiement|merci|fid[ée]lit[ée]|articles?\b|date(?:\s|:)|heure(?:\s|:)|cb\b|esp[èe]ces|ht\b|ttc\b|remise|promo|carte\b|ch[eè]que\b|document\b)|\(\d+\)\s*\d{1,2}[,.]\d{2}\s*%)/i

function cleanReceiptProductName(line: string) {
  return line
    .replace(/^\s*[\d.,]+\s*[xX×]\s*/, '')
    .replace(/\s*[xX×]\s*[\d.,]+\s*$/, '')
    .replace(/\s+\d+[,.]\d{2}\s*(?:€|EUR)?\s*$/i, '')
    .replace(/\s+\d+\.\d{2}\s*(?:€|EUR)?\s*$/i, '')
    .replace(/^[\s*•|:;._-]+|[\s*•|:;._-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseReceiptText(text: string): Omit<ReceiptProduct, 'id'>[] {
  const products = new Map<string, Omit<ReceiptProduct, 'id'>>()

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, ' ').trim()
    if (!line || excludedReceiptLine.test(line) || !/[a-zà-ÿ]/i.test(line)) continue

    const leadingQuantity = /^(\d{1,2})(?:[,.]0+)?\s*[xX×]\s*(.+)$/.exec(line)
    const body = leadingQuantity?.[2] ?? line
    const prices = [...body.matchAll(/(?:^|\s)(\d{1,5}[,.]\d{2})(?=\s|€|EUR|$)/gi)]
    if (prices.length === 0) continue

    const name = cleanReceiptProductName(body.slice(0, prices[0].index).trim())
    if (name.length < 3 || name.length > 120 || !/[a-zà-ÿ]{2}/i.test(name)) continue

    const key = name.toLocaleLowerCase('fr')
    const existing = products.get(key)
    const quantity = leadingQuantity ? Number(leadingQuantity[1].replace(',', '.')) : 1
    products.set(key, { name, quantity: (existing?.quantity ?? 0) + (quantity > 0 ? quantity : 1) })
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
