export type ReceiptProduct = {
  id: string
  name: string
  quantity: number
}

const excludedReceiptLine = /^(?:ticket|caisse|sous.?total|total|tva|rendu|monnaie|paiement|merci|fid[ée]lit[ée]|articles?\b|date(?:\s|:)|heure(?:\s|:)|cb\b|esp[èe]ces|ht\b|ttc\b|remise|promo)\b/i

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
    const trailingQuantity = /^(.+?)\s*[xX×]\s*(\d{1,2})(?:[,.]0+)?(?:\s|$)/.exec(line)
    const quantity = leadingQuantity
      ? Number(leadingQuantity[1].replace(',', '.'))
      : trailingQuantity ? Number(trailingQuantity[2].replace(',', '.')) : 1
    const name = cleanReceiptProductName(leadingQuantity?.[2] ?? trailingQuantity?.[1] ?? line)
    if (name.length < 3 || name.length > 120 || !/[a-zà-ÿ]{2}/i.test(name)) continue

    const key = name.toLocaleLowerCase('fr')
    const existing = products.get(key)
    products.set(key, { name, quantity: (existing?.quantity ?? 0) + (quantity > 0 ? quantity : 1) })
  }

  return [...products.values()]
}
