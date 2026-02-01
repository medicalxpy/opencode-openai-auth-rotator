export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  const days = Math.round(minutes / 1440);
  if (days === 7) {
    return 'weekly';
  }
  return `${days}d`;
}

export function formatResetTime(timestamp: number): string {
  const now = Date.now();
  const resetDate = new Date(timestamp * 1000);
  const diffMs = resetDate.getTime() - now;
  
  if (diffMs < 0) {
    return 'now';
  }
  
  const diffMinutes = Math.round(diffMs / 60000);
  
  if (diffMinutes < 60) {
    return `in ${diffMinutes}m`;
  }
  
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `in ${diffHours}h`;
  }
  
  const diffDays = Math.round(diffHours / 24);
  return `in ${diffDays}d`;
}

export function renderProgressBar(percent: number, segments: number = 20): string {
  const filled = Math.round((percent / 100) * segments);
  const empty = segments - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
