export const interfaceLanguages = [
  { code: 'en', label: 'English', direction: 'ltr' },
  { code: 'zh-Hant', label: '繁體中文', direction: 'ltr' },
  { code: 'zh-Hans', label: '简体中文', direction: 'ltr' },
  { code: 'ar', label: 'العربية', direction: 'rtl' }
];
export const interfaceLanguageCodes = interfaceLanguages.map(language => language.code);
export const translatedLanguageCodes = interfaceLanguageCodes.filter(language => language !== 'en');

const templateCache = new WeakMap();
function templates(dictionary) {
  if (!dictionary || typeof dictionary !== 'object') return [];
  if (templateCache.has(dictionary)) return templateCache.get(dictionary);
  const entries = Object.entries(dictionary).filter(([source]) => /\{\d+\}/.test(source)).map(([source, translation]) => {
    const slots = [];
    let offset = 0, pattern = '';
    for (const match of source.matchAll(/\{(\d+)\}/g)) {
      const suffix = source.slice(match.index + match[0].length);
      const counter = /^ (?:files?|projects?|agents?|box(?:es)?|issues?|messages?|records?|chunks|tools|participants|seconds|KB|MB|directly selected|active|ready|retained|supplied|configured|saved|published|document templates|group messages|typing indicators|pending writes|reusable row)/.test(suffix);
      const omitted = !translation.includes(match[0]);
      // Omitted slots are English grammatical endings, never arbitrary user text.
      const capture = omitted ? '(s| is|s are| has|s have| was|s were|is|are|has|have|was|were| and configured table rules)?' : counter ? '([0-9٠-٩۰-۹][0-9٠-٩۰-۹.,٬٫]*)' : '([\\s\\S]*?)';
      pattern += source.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + capture;
      slots.push(match[1]);
      offset = match.index + match[0].length;
    }
    pattern += source.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { source, translation, slots, pattern: new RegExp(`^${pattern}$`, 'u') };
  }).sort((left, right) => right.source.replace(/\{\d+\}/g, '').length - left.source.replace(/\{\d+\}/g, '').length);
  templateCache.set(dictionary, entries);
  return entries;
}

// Translate only known interface phrases; interpolated names and values are kept verbatim.
export function translateInterface(value, dictionary = {}, overrides = {}) {
  if (Object.hasOwn(overrides, value) && overrides[value]) return overrides[value];
  if (Object.hasOwn(dictionary, value) && dictionary[value]) return dictionary[value];
  if (!/[A-Za-z]/.test(value)) return value;
  for (const entry of [...templates(overrides), ...templates(dictionary)]) {
    const match = entry.pattern.exec(value);
    if (!match) continue;
    const values = Object.fromEntries(entry.slots.map((slot, index) => [slot, match[index + 1] ?? '']));
    return entry.translation.replace(/\{(\d+)\}/g, (placeholder, slot) => values[slot] ?? placeholder);
  }
  return value;
}
