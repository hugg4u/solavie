import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  // Redis
  REDIS_CACHE_URL: z.string().url(),
  REDIS_QUEUE_URL: z.string().url(),

  // Security
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_SETUP_SECRET: z.string().min(1),
  AES_ENCRYPTION_KEY: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.coerce.number().default(900), // 15m
  JWT_REFRESH_EXPIRES_IN: z.coerce.number().default(604800), // 7d
  COOKIE_SECRET: z.string().min(16),
  PERMISSION_CACHE_TTL: z.coerce.number().default(3600), // 1h
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    console.error(
      '❌ Invalid environment variables:',
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
}
