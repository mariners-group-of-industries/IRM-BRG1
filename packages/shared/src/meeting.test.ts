import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEETING_RULES,
  MEETING_STATES,
  MEETING_TRANSITIONS,
  createMeetingSchema,
  findTransition,
  meetingRulesSchema,
  transitionsFrom,
} from './meeting.js';

describe('meeting state machine', () => {
  it('only allows the documented transitions', () => {
    expect(findTransition('DRAFT', 'SCHEDULED')).toBeDefined();
    expect(findTransition('DRAFT', 'LIVE')).toBeUndefined();
    expect(findTransition('COMPLETED', 'LIVE')).toBeUndefined();
    expect(findTransition('ARCHIVED', 'DRAFT')).toBeUndefined();
    expect(findTransition('REGISTRATION_OPEN', 'DRAFT')).toBeUndefined();
  });

  it('archived is terminal and every state is reachable from draft', () => {
    expect(transitionsFrom('ARCHIVED')).toHaveLength(0);
    const seen = new Set(['DRAFT']);
    let frontier = ['DRAFT'];
    while (frontier.length) {
      frontier = frontier.flatMap((s) => MEETING_TRANSITIONS.filter((t) => t.from === s).map((t) => t.to)).filter((s) => !seen.has(s));
      frontier.forEach((s) => seen.add(s));
    }
    expect([...seen].sort()).toEqual([...MEETING_STATES].sort());
  });

  it('live-meeting operations need meeting.control, not configuration rights', () => {
    for (const t of MEETING_TRANSITIONS.filter((t) => ['LIVE', 'PAUSED', 'COMPLETED'].includes(t.to))) {
      expect(t.permissions).toEqual(['meeting.control']);
    }
  });
});

describe('meeting rules', () => {
  it('defaults never allow vote changes or poll demand thresholds by assumption', () => {
    expect(DEFAULT_MEETING_RULES.allowVoteChange).toBe(false);
    expect(DEFAULT_MEETING_RULES.pollDemand.enabled).toBe(false);
    expect(DEFAULT_MEETING_RULES.specialMajority).toEqual({ numerator: 3, denominator: 4 });
  });

  it('rejects impossible values', () => {
    expect(meetingRulesSchema.safeParse({ ordinaryMajority: { numerator: 3, denominator: 2 } }).success).toBe(false);
    expect(meetingRulesSchema.safeParse({ audioQuestionMaxSeconds: 600 }).success).toBe(false);
    expect(meetingRulesSchema.safeParse({ choices: ['FOR'] }).success).toBe(false);
  });
});

describe('meeting input', () => {
  const base = { type: 'AGM', title: '36th Annual General Meeting', scheduledStart: '2026-12-20T10:30:00+06:00', recordDate: '2026-11-20' };
  it('accepts a valid meeting', () => {
    expect(createMeetingSchema.safeParse(base).success).toBe(true);
  });
  it('needs the record date on or before the meeting date', () => {
    expect(createMeetingSchema.safeParse({ ...base, recordDate: '2026-12-21' }).success).toBe(false);
  });
  it('needs a venue for hybrid meetings', () => {
    expect(createMeetingSchema.safeParse({ ...base, mode: 'HYBRID' }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, mode: 'HYBRID', venue: 'Bangabandhu International Conference Center' }).success).toBe(true);
  });
});
