/**
 * Deterministic position lifecycle engine (weighted-average cost).
 *
 * Reconstructs open / increase / reduce / close / flip transitions from a
 * chronological stream of fills, supporting partial closes and multiple fills.
 * Used for prediction-market outcome tokens and for sources that do not
 * report realized P&L themselves. Pure function: same input, same output.
 */

export interface Fill {
  key: string; // position key, e.g. "hyperliquid:BTC" or "polymarket:<asset>"
  timestamp: number;
  /** +1 buy / long, -1 sell / short */
  side: 1 | -1;
  quantity: number; // > 0
  price: number; // USD per unit
}

export type Transition = "OPEN" | "INCREASE" | "REDUCE" | "CLOSE" | "FLIP";

export interface FillResult {
  fill: Fill;
  transition: Transition;
  /** Quantity that closed existing exposure */
  closedQuantity: number;
  entryValue: number; // cost basis of closed quantity
  exitValue: number; // proceeds of closed quantity
  realizedPnl: number;
  openedAt?: number;
  positionAfter: number; // signed
  avgPriceAfter: number;
}

interface PositionState {
  size: number; // signed
  avgPrice: number;
  openedAt: number;
}

const EPS = 1e-9;

export function round(n: number, dp = 8): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export class PositionBook {
  private book = new Map<string, PositionState>();

  apply(fill: Fill): FillResult {
    if (!(fill.quantity > 0) || !Number.isFinite(fill.price)) {
      throw new Error(`Invalid fill for ${fill.key}: quantity ${fill.quantity}, price ${fill.price}`);
    }
    const st = this.book.get(fill.key) ?? { size: 0, avgPrice: 0, openedAt: fill.timestamp };
    const signedQty = fill.side * fill.quantity;
    const before = st.size;

    // Same direction (or flat): open / increase
    if (Math.abs(before) < EPS || Math.sign(before) === fill.side) {
      const newSize = before + signedQty;
      const avg =
        Math.abs(before) < EPS
          ? fill.price
          : (Math.abs(before) * st.avgPrice + fill.quantity * fill.price) / Math.abs(newSize);
      const openedAt = Math.abs(before) < EPS ? fill.timestamp : st.openedAt;
      this.book.set(fill.key, { size: newSize, avgPrice: avg, openedAt });
      return {
        fill,
        transition: Math.abs(before) < EPS ? "OPEN" : "INCREASE",
        closedQuantity: 0,
        entryValue: 0,
        exitValue: 0,
        realizedPnl: 0,
        positionAfter: round(newSize),
        avgPriceAfter: round(avg),
      };
    }

    // Opposite direction: reduce / close / flip
    const closedQty = Math.min(Math.abs(before), fill.quantity);
    const direction = Math.sign(before); // +1 long being reduced, -1 short being reduced
    const entryValue = closedQty * st.avgPrice;
    const exitValue = closedQty * fill.price;
    const realizedPnl = direction * (exitValue - entryValue);
    const remainder = fill.quantity - closedQty;
    const openedAt = st.openedAt;

    let transition: Transition;
    let next: PositionState;
    if (remainder > EPS) {
      transition = "FLIP";
      next = { size: fill.side * remainder, avgPrice: fill.price, openedAt: fill.timestamp };
    } else {
      const newSize = before + signedQty;
      transition = Math.abs(newSize) < EPS ? "CLOSE" : "REDUCE";
      next = { size: Math.abs(newSize) < EPS ? 0 : newSize, avgPrice: st.avgPrice, openedAt };
    }
    this.book.set(fill.key, next);

    return {
      fill,
      transition,
      closedQuantity: round(closedQty),
      entryValue: round(entryValue),
      exitValue: round(exitValue),
      realizedPnl: round(realizedPnl),
      openedAt,
      positionAfter: round(next.size),
      avgPriceAfter: round(next.avgPrice),
    };
  }

  /** Settle the whole remaining position at a fixed price (e.g. outcome resolves to 0 or 1). */
  settle(key: string, price: number, timestamp: number): FillResult | null {
    const st = this.book.get(key);
    if (!st || Math.abs(st.size) < EPS) return null;
    return this.apply({ key, timestamp, side: st.size > 0 ? -1 : 1, quantity: Math.abs(st.size), price });
  }

  get(key: string): { size: number; avgPrice: number } | undefined {
    const st = this.book.get(key);
    return st && Math.abs(st.size) > EPS ? { size: round(st.size), avgPrice: round(st.avgPrice) } : undefined;
  }

  open(): Array<{ key: string; size: number; avgPrice: number }> {
    return [...this.book.entries()]
      .filter(([, s]) => Math.abs(s.size) > EPS)
      .map(([key, s]) => ({ key, size: round(s.size), avgPrice: round(s.avgPrice) }));
  }
}
