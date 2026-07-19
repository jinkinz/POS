/** Minimal ESC/POS command builder — enough for receipts and tickets. */
export class EscPos {
  private chunks: Buffer[] = [];

  init(): this {
    return this.raw([0x1b, 0x40]); // ESC @
  }

  text(s: string): this {
    this.chunks.push(Buffer.from(s, "utf8"));
    return this;
  }

  line(s = ""): this {
    return this.text(s + "\n");
  }

  align(where: "left" | "center" | "right"): this {
    const n = where === "left" ? 0 : where === "center" ? 1 : 2;
    return this.raw([0x1b, 0x61, n]); // ESC a n
  }

  bold(on: boolean): this {
    return this.raw([0x1b, 0x45, on ? 1 : 0]); // ESC E n
  }

  /** 1 = normal, 2 = double width+height (kitchen tickets). */
  size(mult: 1 | 2): this {
    const n = mult === 2 ? 0x11 : 0x00;
    return this.raw([0x1d, 0x21, n]); // GS ! n
  }

  feed(lines = 1): this {
    return this.raw([0x1b, 0x64, lines]); // ESC d n
  }

  cut(): this {
    return this.raw([0x1d, 0x56, 0x42, 0x00]); // GS V B 0 (partial cut)
  }

  raw(bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** "Item name.....  12.50" two-column line clipped to the paper width. */
export function padLine(left: string, right: string, width: number): string {
  const space = width - right.length - 1;
  const clippedLeft = left.length > space ? left.slice(0, space) : left;
  return clippedLeft + " ".repeat(width - clippedLeft.length - right.length) + right;
}

export function wrapText(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}
