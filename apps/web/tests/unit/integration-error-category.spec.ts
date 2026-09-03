/**
 * Turning a vendor's refusal into something an administrator can act on.
 *
 * The categories exist because the status codes do not agree: Meta answers 200
 * with an error body, Twilio uses 401 for a bad token and 403 for a suspended
 * account, Knowlarity uses 400 for both. What a person does next — reconnect,
 * widen a scope, slow down, wait, or open a bug — is the stable axis, and it is
 * what the integrations screen groups by.
 */
import { describe, expect, it } from 'vitest';

import { categoriseIntegrationError, httpStatusOf } from '@/services/integrations/eventLog';
import { TelephonyApiError } from '@/lib/integrations/telephony/http';

const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('integration error categories', () => {
  it('reads the status a TelephonyApiError carries as a field', () => {
    expect(httpStatusOf(new TelephonyApiError('twilio', 401, 'twilio returned 401'))).toBe(401);
    expect(categoriseIntegrationError(new TelephonyApiError('twilio', 401, 'nope'))).toBe('AUTH');
  });

  it('separates a rejected credential from a forbidden action', () => {
    // The distinction that decides who fixes it: AUTH is "reconnect the
    // account", PERMISSION is "the account is fine, it lacks a scope".
    expect(categoriseIntegrationError(withStatus(401))).toBe('AUTH');
    expect(categoriseIntegrationError(withStatus(403))).toBe('PERMISSION');
  });

  it('calls throttling what it is, rather than a client error', () => {
    // 429 is in the 4xx range and would otherwise fall into INVALID_REQUEST,
    // sending somebody to look for a bug in a request that was perfectly good.
    expect(categoriseIntegrationError(withStatus(429))).toBe('RATE_LIMIT');
  });

  it('treats every 5xx as the provider being unavailable', () => {
    for (const status of [500, 502, 503]) {
      expect(categoriseIntegrationError(withStatus(status))).toBe('UNAVAILABLE');
    }
  });

  it('counts the gateway timeout as a timeout, not as an outage', () => {
    expect(categoriseIntegrationError(withStatus(504))).toBe('TIMEOUT');
    expect(categoriseIntegrationError(withStatus(408))).toBe('TIMEOUT');
  });

  it('files the remaining 4xx as a request we got wrong', () => {
    expect(categoriseIntegrationError(withStatus(400))).toBe('INVALID_REQUEST');
    expect(categoriseIntegrationError(withStatus(422))).toBe('INVALID_REQUEST');
    expect(categoriseIntegrationError(withStatus(404))).toBe('NOT_FOUND');
  });

  it('recognises the two shapes a deadline arrives in', () => {
    // AbortSignal.timeout throws a DOMException named TimeoutError; undici's own
    // deadline is an AbortError. Both are the same fact to a reader.
    expect(categoriseIntegrationError(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))).toBe('TIMEOUT');
    expect(categoriseIntegrationError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('TIMEOUT');
  });

  it('recognises a connection that never got anywhere', () => {
    expect(categoriseIntegrationError(new Error('fetch failed'))).toBe('UNAVAILABLE');
    expect(categoriseIntegrationError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe('UNAVAILABLE');
    expect(categoriseIntegrationError(new Error('getaddrinfo ENOTFOUND graph.facebook.com'))).toBe('UNAVAILABLE');
  });

  it('answers UNKNOWN rather than guessing, and says so honestly', () => {
    // A growing count of UNKNOWN means this function needs another case — not
    // that the message matching should get cleverer. Pinning it keeps the
    // fallback a deliberate answer instead of an accident.
    expect(categoriseIntegrationError(new Error('something nobody has seen before'))).toBe('UNKNOWN');
    expect(categoriseIntegrationError('a string, not an error')).toBe('UNKNOWN');
    expect(httpStatusOf(new Error('no status here'))).toBeUndefined();
  });

  it('ignores a status that is not a number', () => {
    expect(httpStatusOf(Object.assign(new Error('x'), { status: 'teapot' }))).toBeUndefined();
  });
});
