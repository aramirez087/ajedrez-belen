import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { knightImage, crestImage } from '../src/data/landing-media';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('landing preload and knight use the same responsive image settings', () => {
  const page = read('src/pages/index.astro');
  const component = read('src/components/KnightScene.astro');
  assert.match(page, /const knight = knightImage\(a.heroKnight\)/);
  assert.match(page, /imagesrcset=\{knight.srcset\} imagesizes=\{knight.sizes\} fetchpriority="high"/);
  assert.match(component, /const image = knightImage\(src\)/);
  assert.match(component, /<img \{\.\.\.image\}/);
});

test('all advertised local image variants exist', () => {
  for (const image of [knightImage('/media/knight-staunton-v4.webp'), crestImage(null)]) {
    for (const candidate of image.srcset!.split(', ')) {
      const [url] = candidate.split(' ');
      assert.ok(existsSync(new URL(`public${url}`, root)), url);
    }
  }
});

test('replacement artwork does not advertise nonexistent generated variants', () => {
  assert.equal(knightImage('/media/custom-knight.png').srcset, undefined);
  assert.equal(crestImage('/media/approved-crest.png').srcset, undefined);
});
