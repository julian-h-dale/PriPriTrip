import { describe, expect, it } from 'vitest';

import { countdown, followingPoints, leaveByHint, nextPoint } from './tripClock';

/** A point as the API serialises it: wall clock AND the derived instant. */
function point(id, startUtc, extra = {}) {
  return {
    pointId: id,
    title: id,
    startUtc,
    endUtc: null,
    completed: false,
    ...extra,
  };
}

function trip(...points) {
  return { days: [{ dayId: 'd1', points }] };
}

const NOW = new Date('2026-10-30T12:00:00Z').getTime();

describe('nextPoint', () => {
  it('picks the earliest point still ahead of you', () => {
    const t = trip(
      point('past', '2026-10-30T09:00:00Z'),
      point('next', '2026-10-30T14:00:00Z'),
      point('later', '2026-10-30T18:00:00Z'),
    );
    expect(nextPoint(t, NOW).pointId).toBe('next');
  });

  it('skips completed points — ticking one off is what advances the screen', () => {
    const t = trip(
      point('done', '2026-10-30T14:00:00Z', { completed: true }),
      point('next', '2026-10-30T18:00:00Z'),
    );
    expect(nextPoint(t, NOW).pointId).toBe('next');
  });

  it('prefers something happening RIGHT NOW over the thing after it', () => {
    // You want the boarding pass while you're boarding.
    const t = trip(
      point('boarding', '2026-10-30T11:30:00Z', { endUtc: '2026-10-30T12:30:00Z' }),
      point('after', '2026-10-30T14:00:00Z'),
    );
    expect(nextPoint(t, NOW).pointId).toBe('boarding');
  });

  it('returns null when the trip is over', () => {
    const t = trip(point('past', '2026-10-29T09:00:00Z'));
    expect(nextPoint(t, NOW)).toBeNull();
  });

  it('returns null for an empty trip', () => {
    expect(nextPoint({ days: [] }, NOW)).toBeNull();
    expect(nextPoint(null, NOW)).toBeNull();
  });

  it('ignores points with no time at all', () => {
    const t = trip(point('untimed', null), point('next', '2026-10-30T14:00:00Z'));
    expect(nextPoint(t, NOW).pointId).toBe('next');
  });

  it('orders across days, not within them', () => {
    const t = {
      days: [
        { dayId: 'd2', points: [point('day2', '2026-10-31T08:00:00Z')] },
        { dayId: 'd1', points: [point('day1', '2026-10-30T20:00:00Z')] },
      ],
    };
    expect(nextPoint(t, NOW).pointId).toBe('day1');
  });

  it('is unaffected by the browser timezone — the whole reason for startUtc', () => {
    // A wall clock of "09:00" is 00:00Z in Tokyo and 14:00Z in Chicago. Comparing
    // instants means the answer does not depend on where the browser thinks it is.
    const t = trip(
      point('tokyo9am', '2026-10-30T00:00:00Z'), // 09:00 Asia/Tokyo — already past
      point('chicago9am', '2026-10-30T14:00:00Z'), // 09:00 America/Chicago — ahead
    );
    expect(nextPoint(t, NOW).pointId).toBe('chicago9am');
  });
});

describe('countdown', () => {
  it('goes urgent as the thing approaches', () => {
    expect(countdown('2026-11-02T12:00:00Z', NOW)).toEqual({ text: 'in 3 days', urgency: 'later' });
    expect(countdown('2026-10-30T14:15:00Z', NOW)).toEqual({ text: 'in 2h 15m', urgency: 'today' });
    expect(countdown('2026-10-30T12:40:00Z', NOW)).toEqual({ text: 'in 40 min', urgency: 'soon' });
  });

  it('says "now" while it is happening', () => {
    const c = countdown('2026-10-30T11:30:00Z', NOW, '2026-10-30T12:30:00Z');
    expect(c).toEqual({ text: 'now', urgency: 'now' });
  });

  it('drops the minutes when they are zero', () => {
    expect(countdown('2026-10-30T15:00:00Z', NOW).text).toBe('in 3h');
  });

  it('never says "4h 60m" — the rounding must carry into the hours', () => {
    // 4h 59m 40s. Flooring the hours and rounding the remainder separately
    // rounded 59m40s up to 60 and printed "in 4h 60m". A screenshot caught it.
    const at = new Date(NOW + 4 * 3600_000 + 59 * 60_000 + 40_000).toISOString();
    expect(countdown(at, NOW).text).toBe('in 5h');
  });

  it('handles the past and the missing', () => {
    expect(countdown('2026-10-30T09:00:00Z', NOW).text).toBe('passed');
    expect(countdown(null, NOW).text).toBe('');
  });
});

describe('followingPoints', () => {
  it('returns what comes after, in order', () => {
    const a = point('a', '2026-10-30T14:00:00Z');
    const t = trip(
      a,
      point('b', '2026-10-30T16:00:00Z'),
      point('c', '2026-10-30T18:00:00Z'),
    );
    expect(followingPoints(t, a).map((p) => p.pointId)).toEqual(['b', 'c']);
  });

  it('is empty at the end of the trip', () => {
    const a = point('a', '2026-10-30T14:00:00Z');
    expect(followingPoints(trip(a), a)).toEqual([]);
  });
});

describe('leaveByHint', () => {
  it('puts you at the airport two hours before a flight', () => {
    const flight = point('f', '2026-10-30T16:00:00Z', {
      type: 'departure',
      travelDetail: { mode: 'flight' },
    });
    const hint = leaveByHint(flight);
    expect(hint.at.toISOString()).toBe('2026-10-30T14:00:00.000Z');
    expect(hint.place).toBe('the airport');
  });

  it('gives a train twenty minutes', () => {
    const train = point('t', '2026-10-30T16:00:00Z', {
      type: 'departure',
      travelDetail: { mode: 'train' },
    });
    expect(leaveByHint(train).at.toISOString()).toBe('2026-10-30T15:40:00.000Z');
  });

  it('says nothing about an ARRIVAL — you do not leave for a landing', () => {
    // It cheerfully told you to be at the airport two hours before you land.
    const arrival = point('a', '2026-10-30T16:00:00Z', {
      type: 'arrival',
      travelDetail: { mode: 'flight' },
    });
    expect(leaveByHint(arrival)).toBeNull();
  });

  it('says nothing for things that are not journeys', () => {
    expect(leaveByHint(point('dinner', '2026-10-30T16:00:00Z', { type: 'activity' }))).toBeNull();
  });
});
