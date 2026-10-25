export const log = (level, msg, extra = {}) => {
  if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return
  console.log(
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  )
}
