import type { Category, LadderLevel, Score } from '../types';

export function flattenCategoryItems(category: Category): { id: string; title: string }[] {
  const items: { id: string; title: string }[] = [];
  category.subItems.forEach((subItem) => {
    if (subItem.details?.length) {
      subItem.details.forEach((detail) => items.push({ id: detail.id, title: detail.title }));
    } else if (subItem.criteria) {
      items.push({ id: subItem.id, title: subItem.title });
    }
  });
  return items;
}

export function calcCategoryScore(
  category: Category,
  level: LadderLevel,
  scores: Record<string, Score>
) {
  const levelCat = { ...category, subItems: category.subItems.filter((s) => s.level === level) };
  const items = flattenCategoryItems(levelCat);
  const excluded = items.filter((i) => scores[i.id] === 'excluded').length;
  const active = Math.max(0, items.length - excluded);
  const total = items.reduce((sum, i) => {
    const s = scores[i.id];
    return sum + (typeof s === 'number' ? s : 0);
  }, 0);
  const max = active * 2;
  const percent = max > 0 ? Math.round((total / max) * 100) : 0;
  return { total, max, percent, excluded, itemCount: items.length };
}

export function calcTotalScore(
  categories: Category[],
  level: LadderLevel,
  scores: Record<string, Score>
) {
  let total = 0, max = 0, excluded = 0;
  categories.forEach((cat) => {
    const s = calcCategoryScore(cat, level, scores);
    total += s.total;
    max += s.max;
    excluded += s.excluded;
  });
  const percent = max > 0 ? Math.round((total / max) * 100) : 0;
  return { total, max, percent, excluded };
}
