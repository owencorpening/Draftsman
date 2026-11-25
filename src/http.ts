// Every network request goes through one function, so tests can replace it
// with recorded responses and no test ever reaches a live API.

import { USER_AGENT } from './version.js';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

export type Http = (url: string, request: HttpRequest) => Promise<HttpResponse>;

/** Largest response accepted, images included. */
export const MAX_BYTES = 25 * 1024 * 1024;

export const liveHttp: Http = async (url, request) => {
  const res = await fetch(url, {
    method: request.method,
    headers: { 'User-Agent': USER_AGENT, ...request.headers },
    ...(request.body !== undefined ? { body: request.body } : {}),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error(`response too large (${length} bytes)`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`response too large (${body.length} bytes)`);
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body };
};
