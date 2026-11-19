// Text formatting shared by the tray, notifications and the window.

/** "1 video" / "3 videos". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** A time in this computer's (or browser's) time zone, e.g. "Wed 11 Nov, 09:00". */
export function formatTime(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date))
}

/** "Every hour at :05". */
export function scheduleLabel(minuteOfHour: number): string {
  return `Every hour at :${String(minuteOfHour).padStart(2, '0')}`
}
