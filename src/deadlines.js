import { Temporal } from '@js-temporal/polyfill';

export const defaultTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
export function makeDeadline(date, time, timeZone = defaultTimeZone()) {
  if (!date) {
    if (time) throw new Error('Choose a due date for the due time.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time || '')) throw new Error('Choose a due date and time.');
  try {
    const local=Temporal.PlainDateTime.from(date+'T'+time);
    return local.toZonedDateTime(timeZone,{disambiguation:'reject'}).toInstant().toString();
  } catch { throw new Error('This date or time is invalid or ambiguous in the selected time zone. Choose another time.'); }
}
export function deadlineParts(instant, timeZone = defaultTimeZone()) {
  if (!instant) return { date:'', time:'' };
  const value=Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return { date:value.toPlainDate().toString(),time:value.toPlainTime().toString({smallestUnit:'minute'}) };
}
export function deadlineInstant(task) {
  return task.dueAt || (task.due ? makeDeadline(task.due,task.dueTime || '17:00',task.dueTimezone || 'Asia/Bangkok') : null);
}
export function isOverdue(task, now=Date.now()) {
  const instant=deadlineInstant(task);
  return task.status!=='Done' && Boolean(instant) && Date.parse(instant)<=now;
}
export function calendarDate(task, timeZone=defaultTimeZone()) {
  return deadlineParts(deadlineInstant(task),timeZone).date;
}
export function isDueToday(task, now=Date.now(), timeZone=defaultTimeZone()) {
  return Boolean(deadlineInstant(task)) && calendarDate(task,timeZone)===Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}
export function formatDeadline(task) {
  const instant=deadlineInstant(task);
  if(!instant) return 'No deadline';
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:task.dueTimezone||defaultTimeZone(),timeZoneName:'short'}).format(new Date(instant));
}
export function calendarTime(task) {
  const instant=deadlineInstant(task);
  return instant?new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(instant)):'';
}
export function timeZoneOptions(selected=defaultTimeZone()) {
  const common=[selected,'Asia/Bangkok','UTC','Asia/Kolkata','Asia/Singapore','Asia/Dubai','Europe/London','Europe/Paris','America/New_York','America/Los_Angeles','Australia/Sydney'];
  const available=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
  return [...new Set([...common,...available])];
}
