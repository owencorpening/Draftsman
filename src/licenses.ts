// The licenses Draftsman knows, and the check every image must pass before it
// is placed: the license is known, and it clearly allows both commercial use
// and changes. Anything unknown or missing fails.

export interface License {
  id: string;
  name: string;
  url?: string;
  commercial: boolean;
  modify: boolean;
  attribution: boolean;
  shareAlike?: boolean;
  /** Why a license that fails, fails. */
  why?: string;
}

const CC = 'https://creativecommons.org/licenses';

export const LICENSES: Record<string, License> = {
  pixabay: {
    id: 'pixabay',
    name: 'Pixabay Content License',
    url: 'https://pixabay.com/service/license-summary/',
    commercial: true,
    modify: true,
    attribution: false,
  },
  pexels: { id: 'pexels', name: 'Pexels License', url: 'https://www.pexels.com/license/', commercial: true, modify: true, attribution: false },
  cc0: { id: 'cc0', name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', commercial: true, modify: true, attribution: false },
  pdm: {
    id: 'pdm',
    name: 'Public Domain Mark',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/',
    commercial: true,
    modify: true,
    attribution: false,
  },
  'public-domain': { id: 'public-domain', name: 'Public domain', commercial: true, modify: true, attribution: false },
  'cc-by': { id: 'cc-by', name: 'CC BY', url: `${CC}/by/4.0/`, commercial: true, modify: true, attribution: true },
  'cc-by-sa': { id: 'cc-by-sa', name: 'CC BY-SA', url: `${CC}/by-sa/4.0/`, commercial: true, modify: true, attribution: true, shareAlike: true },
  own: { id: 'own', name: 'Your own work', commercial: true, modify: true, attribution: false },

  // Known, and failing.
  'cc-by-nc': { id: 'cc-by-nc', name: 'CC BY-NC', commercial: false, modify: true, attribution: true, why: 'no commercial use' },
  'cc-by-nc-sa': { id: 'cc-by-nc-sa', name: 'CC BY-NC-SA', commercial: false, modify: true, attribution: true, why: 'no commercial use' },
  'cc-by-nd': { id: 'cc-by-nd', name: 'CC BY-ND', commercial: true, modify: false, attribution: true, why: 'no changes allowed' },
  'cc-by-nc-nd': {
    id: 'cc-by-nc-nd',
    name: 'CC BY-NC-ND',
    commercial: false,
    modify: false,
    attribution: true,
    why: 'no commercial use and no changes allowed',
  },
  sampling: {
    id: 'sampling',
    name: 'CC Sampling+',
    commercial: false,
    modify: true,
    attribution: true,
    why: 'commercial use is limited to sampling, not the whole work',
  },
  'nc-sampling': { id: 'nc-sampling', name: 'CC NC-Sampling+', commercial: false, modify: true, attribution: true, why: 'no commercial use' },
  gfdl: {
    id: 'gfdl',
    name: 'GNU Free Documentation License',
    commercial: true,
    modify: true,
    attribution: true,
    why: 'it requires a full copy of the license text alongside the image, which a post can’t practically carry',
  },
};

export interface LicenseVerdict {
  pass: boolean;
  /** The Draftsman license, or undefined if the source's license wasn't recognised. */
  license?: License & { version?: string; url?: string };
  /** The license as the source states it. */
  raw: string;
  /** Why it failed; empty on a pass. */
  reasons: string[];
  /** What a pass still asks of the user. */
  obligations: string[];
}

export interface LicenseInput {
  /** The Draftsman license id the source mapped to, if any. */
  licenseId?: string;
  raw: string;
  version?: string;
  url?: string;
  /** Reasons from the source's own reject rules (restricted or non-free files). */
  rejected: string[];
  /** The source's prohibited uses, from its terms. */
  prohibited: string[];
}

/** The check every image must pass before it is placed. */
export function checkLicense(input: LicenseInput): LicenseVerdict {
  const reasons: string[] = [...input.rejected];
  const known = input.licenseId ? LICENSES[input.licenseId] : undefined;
  if (!input.raw.trim() && !input.licenseId) reasons.push('the source gives no license');
  else if (!known) reasons.push(`the license "${input.raw}" isn’t one Draftsman knows, so it can’t be confirmed`);
  else {
    if (!known.commercial || !known.modify) reasons.push(`${known.name}: ${known.why ?? 'not allowed'}`);
    else if (known.why) reasons.push(`${known.name}: ${known.why}`);
  }

  const license = known ? { ...known, ...(input.version ? { version: input.version } : {}), url: input.url || known.url } : undefined;
  const pass = reasons.length === 0;
  const obligations: string[] = [];
  if (pass && license) {
    if (license.attribution) obligations.push('Credit is required by the license; keep the credit line with the image.');
    if (license.shareAlike) obligations.push('Share-alike: a changed version of the image must be shared under the same license.');
    obligations.push(...input.prohibited);
  }
  return { pass, ...(license ? { license } : {}), raw: input.raw, reasons, obligations };
}

/** Maps a source's license text to a Draftsman license id with the source's rules: first match wins. */
export function mapLicense(raw: string, rules: { match: string; license: string }[]): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  return rules.find((r) => new RegExp(r.match, 'i').test(text))?.license;
}
