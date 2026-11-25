// The format of an image source definition. Every preset in sources/ and every
// definition a user adds is checked against this when the server starts.
// sources/source.schema.json is generated from it (npm run schema) so editors
// can check a definition while it's being written.

import * as z from 'zod';

/** A dot path into one search result, like "user" or "imageinfo.0.extmetadata.Artist.value". */
const Path = z.string().min(1).describe('Dot path into one search result, e.g. "user" or "src.large2x"');

/**
 * Where a candidate field comes from: a dot path, or a template whose {path}
 * markers are filled from the result. `html: true` strips tags from the value
 * (Wikimedia's Artist field is HTML).
 */
const Field = z.union([
  Path,
  z.strictObject({ path: Path, html: z.boolean().optional() }),
  z.strictObject({ template: z.string().min(1).describe('Text with {path} markers, e.g. "https://pixabay.com/users/{user}-{user_id}/"') }),
]);

const Auth = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.enum(['query', 'header']),
    /** Query parameter name (query) or header name (header). */
    name: z.string().min(1),
    /** Text before the key in a header, such as "Bearer ". */
    prefix: z.string().optional(),
    /** Environment variable that may hold the key. */
    env: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'an environment variable name in capitals, like DRAFTSMAN_PIXABAY_KEY'),
    /** Where to get a key, shown when none is set. */
    getKeyUrl: z.url(),
  }),
]);

const LicenseRule = z.strictObject({
  /** A regular expression tested against the source's license text, without regard to case. */
  match: z.string().min(1),
  /** The Draftsman license it means; see src/licenses.ts. */
  license: z.string().min(1),
});

const License = z.union([
  z.strictObject({
    /** Every result from this source is under one license, like Pixabay's. */
    fixed: z.string().min(1),
    /**
     * The result's page URL must match this, or the license is treated as
     * unknown: it proves the result really comes from the source.
     */
    pageUrlPattern: z.string().min(1),
    url: z.url().describe('The license text'),
  }),
  z.strictObject({
    field: Path.describe('Where the license name is'),
    versionField: Path.optional(),
    urlField: Path.optional(),
    map: z.array(LicenseRule).min(1).describe('First match wins; no match means unknown, which fails the check'),
  }),
]);

const Reject = z.strictObject({
  field: Path,
  /** Fails the check when the field is present and not empty, or equals one of these values. */
  when: z.union([z.literal('present'), z.array(z.string()).min(1)]),
  reason: z.string().min(1),
});

const Terms = z.strictObject({
  read: z.iso.date().describe('When the terms below were read, YYYY-MM-DD'),
  links: z.array(z.strictObject({ url: z.url(), about: z.string().min(1) })).min(1),
  /** What the terms say, briefly, for each rule they set. */
  notes: z.array(z.string().min(1)).min(1),
});

const Use = z.strictObject({
  mode: z.enum(['download', 'hotlink']).describe('download: save the image beside the article. hotlink: link to the source’s copy'),
  cacheSeconds: z.int().min(0).describe('How long a search result may be reused'),
  onPick: z
    .strictObject({
      url: z.string().min(1).describe('Called when an image is placed: a template with {path} markers into the result, e.g. "{links.download_location}"'),
      method: z.enum(['GET', 'POST']),
    })
    .optional(),
  /** What the user must still do or avoid with every image from this source, from its terms. */
  prohibited: z.array(z.string().min(1)).default([]),
});

const Fields = z.strictObject({
  id: Field,
  title: Field.optional(),
  pageUrl: Field,
  imageUrl: Field.describe('The image to place: download or hotlink'),
  thumbnailUrl: Field.optional(),
  width: Field.optional(),
  height: Field.optional(),
  creator: Field.optional(),
  creatorUrl: Field.optional(),
});

const Base = {
  $schema: z.string().optional(),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter'),
  name: z.string().min(1),
  enabledByDefault: z.boolean(),
  terms: Terms,
  license: License,
  reject: z.array(Reject).default([]),
  use: Use,
  credit: z
    .string()
    .min(1)
    .describe('Markdown with markers: {title}, {creator}, {creatorLink}, {page}, {licenseName}, {licenseLink}, {sourceName}'),
};

const ApiSource = z.strictObject({
  ...Base,
  kind: z.literal('api'),
  auth: Auth,
  search: z.strictObject({
    url: z.string().startsWith('https://').describe('Template: {query} and {count} are filled in, URL-encoded'),
    headers: z.record(z.string(), z.string()).default({}),
    results: Path.describe('Where the list of results is in the response'),
    maxCount: z.int().min(1),
  }),
  fields: Fields,
});

const FolderSource = z.strictObject({
  ...Base,
  kind: z.literal('folder'),
  /** Each image may have a sidecar <image>.json with title, creator, creatorUrl, pageUrl and license. */
  sidecar: z.strictObject({ license: Path, title: Path, creator: Path, creatorUrl: Path, pageUrl: Path }),
});

export const SourceDefinition = z.discriminatedUnion('kind', [ApiSource, FolderSource]);

export type SourceDefinition = z.infer<typeof SourceDefinition>;
export type ApiSourceDefinition = z.infer<typeof ApiSource>;
export type FolderSourceDefinition = z.infer<typeof FolderSource>;
export type FieldSpec = z.infer<typeof Field>;

/** The JSON Schema written to sources/source.schema.json. */
export function sourceJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(SourceDefinition, { io: 'input', target: 'draft-2020-12' }),
    title: 'Draftsman image source',
  };
}
