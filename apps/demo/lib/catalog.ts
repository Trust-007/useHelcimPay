/** The demo store's catalog. Prices are in cents; the server is the only place totals are computed for payment. */
export interface Product {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
  icon: 'tote' | 'mug' | 'stickers';
  tint: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: 'tote',
    name: 'Field Tote',
    blurb: 'Heavy canvas. Fits a laptop and lunch.',
    priceCents: 2400,
    icon: 'tote',
    tint: '#d97706',
  },
  {
    id: 'mug',
    name: 'Enamel Camp Mug',
    blurb: 'Chip-resistant, 12 oz, dishwasher safe.',
    priceCents: 1650,
    icon: 'mug',
    tint: '#0284c7',
  },
  {
    id: 'stickers',
    name: 'Sticker Pack',
    blurb: 'Five matte vinyl stickers.',
    priceCents: 495,
    icon: 'stickers',
    tint: '#7c3aed',
  },
];

export const MAX_QTY = 9;
export const CURRENCY = 'CAD' as const;

export type CartLine = { id: string; qty: number };
export type Cart = { items: CartLine[] };

export const DEFAULT_CART: Record<string, number> = { tote: 1, mug: 1, stickers: 0 };

/**
 * Computes the cart total in cents. Throws with a user-facing message on bad
 * input. It runs on the server for the charge, and on the client only for display.
 */
export function cartTotalCents(cart: unknown): number {
  const items = (cart as Partial<Cart> | null)?.items;
  if (!Array.isArray(items)) throw new Error('Invalid cart');
  let total = 0;
  const seen = new Set<string>();
  for (const line of items) {
    const product = PRODUCTS.find((p) => p.id === line?.id);
    if (!product) throw new Error(`Unknown product: ${String(line?.id)}`);
    if (seen.has(product.id)) throw new Error(`Duplicate product: ${product.id}`);
    seen.add(product.id);
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) {
      throw new Error(`Quantity for ${product.name} must be 1-${MAX_QTY}`);
    }
    total += product.priceCents * line.qty;
  }
  if (total === 0) throw new Error('Your cart is empty');
  return total;
}

export function formatCents(cents: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}
