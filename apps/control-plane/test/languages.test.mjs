import test from 'node:test';
import assert from 'node:assert/strict';
import { interfaceLanguages, interfaceLanguageCodes, translateInterface } from '../public/languages.js';
import { arabicTranslations } from '../public/translations-ar.js';
import { extendedTranslations } from '../public/translations.js';

test('Arabic is selectable and covers the existing platform translation catalogue', () => {
  assert.ok(interfaceLanguageCodes.includes('ar'));
  assert.equal(interfaceLanguages.find(language => language.code === 'ar').direction, 'rtl');
  const missing = Object.keys(extendedTranslations['zh-Hant']).filter(source => !arabicTranslations[source]);
  assert.deepEqual(missing, [], 'Existing interface translations must also be available in Arabic');
});

test('dynamic Arabic messages retain names, numbers and punctuation for singular and plural cases', () => {
  assert.equal(translateInterface('Continue with Sally', arabicTranslations), 'متابعة مع Sally');
  assert.equal(translateInterface('1 file uploaded.', arabicTranslations), 'رُفعت الملفات وعددها 1.');
  assert.equal(translateInterface('12 files uploaded.', arabicTranslations), 'رُفعت الملفات وعددها 12.');
  assert.equal(translateInterface('Ask Sally about Harbour [A]+…', arabicTranslations), 'اسأل Sally عن Harbour [A]+…');
  assert.equal(translateInterface('Current process: 120 ms', arabicTranslations), 'العملية الحالية: 120 مللي ثانية');
  assert.equal(translateInterface('This is a user-authored project note.', arabicTranslations), 'This is a user-authored project note.');
});

test('approved Arabic corrections override built-in exact and dynamic phrases safely', () => {
  assert.equal(translateInterface('Projects', arabicTranslations, { Projects: 'المشروعات' }), 'المشروعات');
  assert.equal(translateInterface('Continue with Sally', arabicTranslations, { 'Continue with {0}': 'تحدث إلى {0}' }), 'تحدث إلى Sally');
  assert.equal(translateInterface('Projects', arabicTranslations, { Projects: '' }), 'المشاريع');
  assert.equal(translateInterface('toString', arabicTranslations), 'toString');
  assert.equal(translateInterface('Projects'), 'Projects');
});

test('Arabic translations contain usable text and do not introduce interpolation slots', () => {
  for (const [source, translation] of Object.entries(arabicTranslations)) {
    assert.match(translation, /[\u0600-\u06ff]/u, source);
    const sourceSlots = new Set(source.match(/\{\d+\}/g) || []);
    for (const slot of translation.match(/\{\d+\}/g) || []) assert.ok(sourceSlots.has(slot), `${source}: unknown ${slot}`);
  }
});
