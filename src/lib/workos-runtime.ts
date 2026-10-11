import type { APIContext } from 'astro';
import {
  configure,
  CookieSessionStorage,
  createAuthService,
  type CookieOptions,
  type HeadersBag,
} from '@workos/authkit-session';
import { getAuthConfigurationStatus, type AuthEnvironment } from './auth';

type Cookies = APIContext['cookies'];

/**
 * Framework glue only: AuthKit owns PKCE, cryptography, JWT validation, and
 * refresh. Astro owns cookie parsing and appending its pending Set-Cookie values.
 */
class AstroCookieStorage extends CookieSessionStorage<Cookies, Cookies> {
  async getCookie(cookies: Cookies, name: string): Promise<string | null> {
    return cookies.get(name)?.value ?? null;
  }

  async setCookie(cookies: Cookies | undefined, name: string, value: string, options: CookieOptions) {
    if (!cookies) return super.setCookie(undefined, name, value, options);
    cookies.set(name, value, options);
    return { response: cookies };
  }

  async clearCookie(cookies: Cookies | undefined, name: string, options: CookieOptions) {
    if (!cookies) return super.clearCookie(undefined, name, options);
    cookies.delete(name, { path: options.path, domain: options.domain });
    return { response: cookies };
  }
}

let service: ReturnType<typeof createAuthService<Cookies, Cookies>> | undefined;

export function getAuthService(environment: AuthEnvironment) {
  if (!getAuthConfigurationStatus(environment).configured) return null;
  if (!service) {
    configure({
      clientId: environment.WORKOS_CLIENT_ID!,
      apiKey: environment.WORKOS_API_KEY!,
      redirectUri: environment.WORKOS_REDIRECT_URI!,
      cookiePassword: environment.WORKOS_COOKIE_PASSWORD!,
      cookieMaxAge: 60 * 60 * 8,
      cookieSameSite: 'lax',
    });
    service = createAuthService<Cookies, Cookies>({
      sessionStorageFactory: (config) => new AstroCookieStorage(config),
    });
  }
  return service;
}

/** Logout uses the SDK's headers-only path. Preserve every separate cookie. */
export function appendAuthHeaders(response: Response, headers: HeadersBag | undefined): Response {
  for (const [name, value] of Object.entries(headers ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) response.headers.append(name, entry);
  }
  return response;
}
