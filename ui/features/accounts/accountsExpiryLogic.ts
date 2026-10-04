/**
 * Pure logic for PAT expiry calculation and warning display.
 * Shared between StatusBar and AccountsSettings.
 */

/** Calculate days left from an expiry date string (YYYY-MM-DD or ISO). */
export function calcPatDaysLeft(expiresAt: string | null | undefined): { daysLeft: number | null; expired: boolean } {
  if (!expiresAt) return { daysLeft: null, expired: false };
  const dateStr = expiresAt.length === 10 ? expiresAt + 'T23:59:59' : expiresAt;
  const exp = new Date(dateStr);
  if (isNaN(exp.getTime())) return { daysLeft: null, expired: false };
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return { daysLeft: days, expired: days < 0 };
}

/** Check if PAT needs warning (<=14 days or expired). */
export function patNeedsWarning(daysLeft: number | null, expired: boolean): boolean {
  if (expired) return true;
  if (daysLeft !== null && daysLeft <= 14) return true;
  return false;
}

/** Format PAT indicator text for status bar. */
export function formatPatIndicator(daysLeft: number | null, expired: boolean): string {
  if (expired) return '⚠️ PAT Expired';
  if (daysLeft !== null && daysLeft <= 14) return `⚠️ PAT: ${daysLeft}d`;
  return '';
}
