type CalendarDay = {
  year: number
  month: number
  day: number
}

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>()
const searchWindowMs = 36 * 60 * 60 * 1000

export function startOfDayISO(date: Date, timeZone: string) {
  return new Date(firstInstantOfDay(calendarDay(date), timeZone)).toISOString()
}

export function endOfDayISO(date: Date, timeZone: string) {
  const nextDay = addCalendarDays(calendarDay(date), 1)
  return new Date(firstInstantOfDay(nextDay, timeZone) - 1).toISOString()
}

function firstInstantOfDay(day: CalendarDay, timeZone: string) {
  const anchor = Date.UTC(day.year, day.month - 1, day.day)
  let low = anchor - searchWindowMs
  let high = anchor + searchWindowMs

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)

    if (compareCalendarDays(calendarDayAt(middle, timeZone), day) < 0) low = middle + 1
    else high = middle
  }

  if (compareCalendarDays(calendarDayAt(low, timeZone), day) !== 0) {
    throw new RangeError(`Calendar day does not exist in ${timeZone}`)
  }

  return low
}

function calendarDay(date: Date): CalendarDay {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

function calendarDayAt(timestamp: number, timeZone: string): CalendarDay {
  let formatter = dayFormatterCache.get(timeZone)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    dayFormatterCache.set(timeZone, formatter)
  }

  const values = new Map(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  }
}

function compareCalendarDays(left: CalendarDay, right: CalendarDay) {
  return left.year - right.year || left.month - right.month || left.day - right.day
}

function addCalendarDays(day: CalendarDay, days: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + days))

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}