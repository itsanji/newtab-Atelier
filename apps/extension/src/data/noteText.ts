type Node = { type?: string; text?: string; content?: Node[] };

/** Plain text of a TipTap JSON document; blocks are joined with spaces. */
export function noteText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (typeof n.text === 'string') parts.push(n.text);
    else if (n.type === 'hardBreak') parts.push(' ');
    for (const k of n.content ?? []) walk(k);
    if (typeof n.text !== 'string') parts.push(' ');
  };
  if (doc && typeof doc === 'object') walk(doc as Node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
