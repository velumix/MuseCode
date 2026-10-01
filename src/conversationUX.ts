export function projectName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Choose a project';
}

export function correctionPrompt(answer: string, correction: string): string {
  const excerpt = Array.from(answer.trim()).slice(0, 600).join('');
  return `Please correct this earlier response:\n${excerpt}\n\nWhat to change:\n${correction.trim()}`;
}

export function lessonDraft(correction: string): string {
  return Array.from(correction.trim()).slice(0, 1200).join('');
}

export function lessonTitle(lesson: string): string {
  const text = lesson.trim().split('\n')[0].replace(/\s+/g, ' ');
  const encoder = new TextEncoder();
  let result = '', bytes = 0;
  for (const character of text || 'Project lesson') {
    bytes += encoder.encode(character).length;
    if (bytes > 160 || Array.from(result).length >= 80) break;
    result += character;
  }
  return result;
}

export function lastMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return items[index];
  return undefined;
}

export function groupActivity<T extends { kind: string; id: number | string }>(blocks: T[], enabled: boolean): ({kind:'block';id:T['id'];block:T} | { kind: 'activity_group'; id: T['id']; items: T[] })[] {
  const result: ({kind:'block';id:T['id'];block:T} | { kind: 'activity_group'; id: T['id']; items: T[] })[] = [];
  for (const block of blocks) {
    if (!enabled || block.kind !== 'tool') { result.push({kind:'block',id:block.id,block}); continue; }
    const previous = result[result.length - 1];
    if (previous?.kind === 'activity_group') previous.items.push(block);
    else result.push({kind:'activity_group',id:block.id,items:[block]});
  }
  return result;
}
