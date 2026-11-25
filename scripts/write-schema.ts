// Writes sources/source.schema.json from the source definition format in
// src/sources/schema.ts. A test fails if the committed file is out of date.
//
//   npm run schema

import { writeFile } from 'node:fs/promises';

import { sourceJsonSchema } from '../src/sources/schema.js';

await writeFile('sources/source.schema.json', JSON.stringify(sourceJsonSchema(), null, 2) + '\n');
console.log('wrote sources/source.schema.json');

const { styleJsonSchema } = await import('../src/styles.js');
await writeFile('styles/style.schema.json', JSON.stringify(styleJsonSchema(), null, 2) + '\n');
console.log('wrote styles/style.schema.json');
