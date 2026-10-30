/**
 * Page-side DOM shape collector — spec §7.2.
 *
 * Reduces a region of the DOM to tag names, attribute NAMES and counts. It never
 * reads text nodes or attribute values, which is what makes the breakage report
 * safe to share. Lives in `shared` so the bridge (which runs it in the page) and
 * the extension (which writes the report) use the same code.
 */

export interface DomShape {
  tags: string[];
  attributeNames: string[];
  counts: Record<string, number>;
}

export const DOM_SHAPE_SNIPPET = `((selector) => {
  const roots = selector ? Array.from(document.querySelectorAll(selector)).slice(0, 3) : [document.body].filter(Boolean);
  const tags = [];
  const attributeNames = new Set();
  const counts = {};
  for (const root of roots) {
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))].slice(0, 400);
    for (const el of nodes) {
      const tag = (el.tagName || '').toLowerCase();
      if (!tag) continue;
      tags.push(tag);
      counts[tag] = (counts[tag] || 0) + 1;
      for (const attr of Array.from(el.attributes || [])) attributeNames.add(attr.name);
    }
  }
  return { tags: tags.slice(0, 200), attributeNames: Array.from(attributeNames).sort().slice(0, 200), counts };
})`;
