import { useEffect, useState } from 'react';
import { progressMessage, type ProviderProgress } from '../providerProgress';

// One compact live line shared by desktop and phone. The timestamp survives
// replay/reconnection; reconnecting must not restart the provider's countdown.
export default function ProviderWait({ progress }: { progress: ProviderProgress }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (progress.retry_at_ms == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.retry_at_ms]);
  const seconds = progress.retry_at_ms == null ? null : Math.max(0, Math.ceil((progress.retry_at_ms - now) / 1000));
  return <span className="provider-wait">
    {progressMessage(progress)} · {seconds === null ? 'Waiting to retry' : seconds ? `Retrying in ${seconds}s` : 'Waiting for retry'}
    {progress.attempt != null && ` · attempt ${progress.attempt}${progress.max_attempts != null ? `/${progress.max_attempts}` : ''}`}
    . You can stop and try another model or provider.
  </span>;
}
