import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'token',
      '*.token',
      'tokenHash',
      '*.tokenHash',
      'secret',
      '*.secret',
      'apiKey',
      '*.apiKey',
      'otp',
      '*.otp',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  base: { service: 'leadflow', role: env.PROCESS_ROLE },
});
