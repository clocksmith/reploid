/** Regenerate a standalone viewer from the canonical JSON and source. */
import {readFile,writeFile} from 'node:fs/promises';
import {validateDocument} from './source/core.mjs';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const [template,data,core,viewer]=await Promise.all([read('./source/page.html'),read('./diagram.json'),read('./source/core.mjs'),read('./source/viewer.js')]);
validateDocument(JSON.parse(data));
const html=template.replace('__DIAGRAM_DATA__',data.replaceAll('<','\\u003c'))
  .replace('__CORE__',core.replaceAll('export function','function').replaceAll('export const','const'))
  .replace('__VIEWER__',viewer);
await writeFile(new URL('./index.html',import.meta.url),html);
console.log('Built index.html from diagram.json and source/.');
