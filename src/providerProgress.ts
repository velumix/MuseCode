import { providerNames, type Provider } from './providers';

export interface ProviderProgress {
  phase: 'connecting' | 'retrying' | 'connected';
  checked_at_ms: number;
  attempt: number | null;
  max_attempts: number | null;
  http_status: number | null;
  retry_at_ms: number | null;
}

export function progressMessage(progress: ProviderProgress, provider: Provider = 'muse'): string {
  const name = providerNames[provider];
  if (progress.phase === 'connecting') return `Connecting to ${name}…`;
  if (progress.phase === 'connected') return `${name} response received`;
  const code = progress.http_status;
  if (code === 401) return `${name} sign-in was rejected (HTTP 401)`;
  if (code === 403) return `${name} service denied the request (HTTP 403)`;
  if (code === 429) return `${name} service is rate limited (HTTP 429)`;
  if (code && code >= 500 && code <= 599) return `${name} service is temporarily unavailable (HTTP ${code})`;
  return code ? `${name} request failed (HTTP ${code})` : `${name} is retrying the connection`;
}
