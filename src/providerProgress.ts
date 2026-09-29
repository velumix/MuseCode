export interface ProviderProgress {
  phase: 'connecting' | 'retrying' | 'connected';
  checked_at_ms: number;
  attempt: number | null;
  max_attempts: number | null;
  http_status: number | null;
  retry_at_ms: number | null;
}

export function progressMessage(progress: ProviderProgress): string {
  if (progress.phase === 'connecting') return 'Connecting to Muse…';
  if (progress.phase === 'connected') return 'Muse response received';
  const code = progress.http_status;
  if (code === 401) return 'Muse sign-in was rejected (HTTP 401)';
  if (code === 403) return 'Muse service denied the request (HTTP 403)';
  if (code === 429) return 'Muse service is rate limited (HTTP 429)';
  if (code && code >= 500) return `Muse service is temporarily unavailable (HTTP ${code})`;
  return code ? `Muse request failed (HTTP ${code})` : 'Muse connection was interrupted';
}
