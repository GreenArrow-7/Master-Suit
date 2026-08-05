/**
 * RFC 9457 problem+json. Every error the API returns is one of these; nothing else
 * escapes the kernel. `expose` marks the ones safe to show verbatim to a caller.
 */
export type FieldError = { field: string; code: string; message: string };

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: FieldError[] = [],
    readonly expose = true,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toProblem(requestId: string) {
    return {
      type: `https://docs.leadflow.example/errors/${this.code}`,
      title: TITLES[this.status] ?? 'Error',
      status: this.status,
      detail: this.expose ? this.message : 'The request could not be completed.',
      requestId,
      ...(this.errors.length ? { errors: this.errors } : {}),
    };
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Not permitted',
  404: 'Not found',
  409: 'Conflict',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Internal error',
  503: 'Service unavailable',
};

export const Unauthorized = (m = 'Sign in to continue.') => new AppError(401, 'unauthorized', m);
export const Forbidden = (m = 'Your role does not allow this action.') => new AppError(403, 'forbidden', m);
export const Conflict = (m: string) => new AppError(409, 'conflict', m);
export const TooManyRequests = (m = 'Slow down and try again shortly.') => new AppError(429, 'rate-limited', m);
export const Invalid = (errors: FieldError[]) =>
  new AppError(422, 'validation-failed', `${errors.length} field${errors.length === 1 ? '' : 's'} failed validation`, errors);

/**
 * Out-of-tenant and out-of-visibility both return 404. A 403 would confirm the
 * record exists, which is itself a cross-tenant leak. See docs/03-API.md §3.
 */
export const NotFound = (what = 'Record') => new AppError(404, 'not-found', `${what} not found.`);
