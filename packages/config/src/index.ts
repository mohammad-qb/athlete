import { z } from "zod";

/**
 * Fail-fast environment validation. The app refuses to boot with a half-configured
 * environment rather than failing on the first request that needs the missing value.
 */
/** One reverse proxy the forwarded-address chain may be trusted through: an IP or a CIDR range. */
const ProxyAddress = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // The application role (athlete_app): serves requests, cannot read a credential.
  DATABASE_URL: z.url(),
  // The auth role (athlete_auth): what better-auth connects as. A separate role and a
  // separate pool, so the connection that holds password hashes and session tokens is
  // never the one a request handler's query runs on.
  AUTH_DATABASE_URL: z.url(),
  // The origin the BROWSER sees (scheme://host[:port]), which behind Front Door is not
  // the origin this process listens on. It is the one origin allowed to make
  // state-changing requests, and the base better-auth builds its cookies for.
  APP_BASE_URL: z.url(),
  // Comma-separated IPs or CIDR ranges of the reverse proxies in front of the API (in
  // production: Front Door's backend ranges). The sign-in rate limit is per client
  // address, and behind two proxies X-Forwarded-For holds a chain: without this list no
  // address in it can be trusted, and every client shares one bucket. Empty when the
  // API is reached directly. A malformed entry fails the boot rather than being ignored.
  AUTH_TRUSTED_PROXIES: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(ProxyAddress)),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // In production this is injected from Azure Key Vault via Container Apps secrets.
  // It is better-auth's `secret`: the key session cookies are signed with.
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
