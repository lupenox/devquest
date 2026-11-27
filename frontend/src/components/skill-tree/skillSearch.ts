import type { SkillTreeNode } from "../../types";

function normalize(text: string) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
}

export function indexSkills(nodes: SkillTreeNode[]) {
  return nodes.map(node => ({
    id: node.id,
    fields: [node.title, node.tech_name, node.tech_slug, node.id, node.category, node.kind]
      .map(normalize),
  }));
}

export function closestSkill(query: string, skills: ReturnType<typeof indexSkills>) {
  const phrase = normalize(query);
  if (!phrase) return null;
  const terms = phrase.split(" ");
  let bestId: string | null = null;
  let bestScore = 0;
  for (const {id, fields} of skills) {
    let score = 0;
    for (const term of terms) {
      let quality = 0;
      fields.forEach((field, index) => {
        const words = field.split(" ");
        const strength = words.includes(term) ? 4
          : words.some(word => word.startsWith(term)) ? 3
          : term.length >= 3 && field.includes(term) ? 1 : 0;
        quality = Math.max(quality, strength * (index < 2 ? 3 : 2));
      });
      if (!quality) { score = 0; break; }
      score += quality;
    }
    if (!score) continue;
    if (fields[0] === phrase) score += 100;
    else if (fields[0].startsWith(phrase)) score += 12;
    if (fields[1] === phrase) score += 15;
    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  return bestId;
}
