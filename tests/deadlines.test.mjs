import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeadline, deadlineParts, isOverdue, isDueToday, calendarDate } from '../src/deadlines.js';

test('Bangkok due time is stored as the correct UTC instant',()=>{
  assert.equal(makeDeadline('2026-10-29','17:30','Asia/Bangkok'),'2026-10-29T10:30:00Z');
  assert.deepEqual(deadlineParts('2026-10-29T10:30:00Z','Asia/Bangkok'),{date:'2026-10-29',time:'17:30'});
});
test('daylight-saving offsets are applied and ambiguous or missing times are rejected',()=>{
  assert.equal(makeDeadline('2026-07-01','15:00','America/New_York'),'2026-07-01T19:00:00Z');
  assert.equal(makeDeadline('2026-01-01','15:00','America/New_York'),'2026-01-01T20:00:00Z');
  assert.throws(()=>makeDeadline('2026-03-08','02:30','America/New_York'),/invalid or ambiguous/);
  assert.throws(()=>makeDeadline('2026-11-01','01:30','America/New_York'),/invalid or ambiguous/);
});
test('due-date and time pairs are validated',()=>{
  assert.equal(makeDeadline('','','Asia/Bangkok'),null);
  assert.throws(()=>makeDeadline('','17:00','Asia/Bangkok'),/Choose a due date/);
  assert.throws(()=>makeDeadline('2026-10-29','','Asia/Bangkok'),/date and time/);
  assert.throws(()=>makeDeadline('2026-02-30','17:00','Asia/Bangkok'),/invalid or ambiguous/);
});
test('a task becomes overdue at its time and completed tasks are excluded',()=>{
  const task={dueAt:'2026-10-29T10:30:00Z',dueTimezone:'Asia/Bangkok',status:'To do'};
  assert.equal(isOverdue(task,Date.parse('2026-10-29T10:29:59Z')),false);
  assert.equal(isOverdue(task,Date.parse('2026-10-29T10:30:00Z')),true);
  assert.equal(isOverdue({...task,status:'Done'},Date.parse('2026-10-29T11:00:00Z')),false);
});
test('calendar days follow the viewer time zone across midnight',()=>{
  const task={dueAt:'2026-10-29T23:30:00Z',dueTimezone:'UTC',status:'To do'};
  assert.equal(calendarDate(task,'Asia/Bangkok'),'2026-10-30');
  assert.equal(calendarDate(task,'America/New_York'),'2026-10-29');
  assert.equal(isDueToday(task,Date.parse('2026-10-30T02:00:00Z'),'Asia/Bangkok'),true);
});
