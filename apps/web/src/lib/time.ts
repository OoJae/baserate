const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue 27 Oct 2026, 19:02 UTC" (or "Tue 27 Oct 2026" with `dateOnly`) from unix seconds. */
export function formatUtc(seconds: number, opts: { dateOnly?: boolean } = {}): string {
  const d = new Date(seconds * 1000)
  const date = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  if (opts.dateOnly) return date
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date}, ${hh}:${mm} UTC`
}
