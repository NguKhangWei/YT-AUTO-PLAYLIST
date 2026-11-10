/** Malaysia Time (UTC+8, no daylight saving). Default for new schedulers. */
export const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur'

/** True if `tz` is an IANA time zone name the runtime's Intl data recognises. */
export function isValidTimeZone(tz: string): boolean {
  if (tz.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
