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
  STORAGE_PUBLIC_URL: z
    .string()
    .url()
    .default('http://localhost:9000/user-media'),
  JWT_SETUP_EXPIRES_IN: z.string().default('15m'),
  JWT_SETUP_COOKIE_MAX_AGE_MS: z.coerce.number().default(15 * 60 * 1000), // 15m
  BRUTE_FORCE_BLOCK_MIN_SEC: z.coerce.number().default(300), // 5m
  BRUTE_FORCE_BLOCK_MAX_SEC: z.coerce.number().default(900), // 15m
  ACTIVATION_TOKEN_TTL_SEC: z.coerce.number().default(172800), // 48h
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5174,http://localhost:3000'),

  // Super Admin Seeding
  SUPER_ADMIN_ID: z
    .string()
    .uuid()
    .default('00000000-0000-0000-0000-000000000000'),
  SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@solavie.vn'),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default('SuperSecurePassword@2026'),
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
