import { describe, expect, it } from 'vitest';

import {
  byDateAsc,
  firstLocationByRole,
  formatDate,
  formatDateOrdinal,
  formatDateRange,
  formatDateTime,
  localityLabel,
  toDateTimeLocal,
} from './format';

describe('localityLabel', () => {
  it('reduces a full address to the last two parts', () => {
    expect(localityLabel({ fullAddress: '1-2-3 Shuri, Naha, Okinawa, Japan' })).toBe('Okinawa, Japan');
  });

  it('falls back to the name when there is no address', () => {
    expect(localityLabel({ name: 'Hyatt Regency' })).toBe('Hyatt Regency');
  });

  it('handles a single-part address', () => {
    expect(localityLabel({ fullAddress: 'Japan', name: 'X' })).toBe('Japan');
  });

  it('returns an em dash for nothing at all', () => {
    expect(localityLabel(null)).toBe('—');
    expect(localityLabel({})).toBe('—');
  });
});

describe('firstLocationByRole', () => {
  const locations = [
    { role: 'origin', name: 'Seattle' },
    { role: 'destination', name: 'Naha' },
    { role: 'destination', name: 'Ignored second' },
  ];

  it('finds the first match', () => {
    expect(firstLocationByRole(locations, 'destination').name).toBe('Naha');
  });

  it('returns null when absent or undefined', () => {
    expect(firstLocationByRole(locations, 'venue')).toBeNull();
    expect(firstLocationByRole(undefined, 'origin')).toBeNull();
  });
});

describe('date formatters', () => {
  it('formats dates, datetimes, and ranges', () => {
    expect(formatDate('2026-10-30')).toBe('Oct 30, 2026');
    expect(formatDateTime('2026-10-30T14:15:00')).toBe('Oct 30, 2026 2:15 PM');
    expect(formatDateRange('2026-10-30', '2026-11-05')).toBe('Oct 30, 2026 - Nov 5, 2026');
  });

  it('uses the fallback for missing values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime(null, 'No check-in date')).toBe('No check-in date');
  });

  it('adds ordinal suffixes, including the 11-13 exceptions', () => {
    expect(formatDateOrdinal('2026-10-01')).toBe('October 1st');
    expect(formatDateOrdinal('2026-10-02')).toBe('October 2nd');
    expect(formatDateOrdinal('2026-10-03')).toBe('October 3rd');
    expect(formatDateOrdinal('2026-10-04')).toBe('October 4th');
    expect(formatDateOrdinal('2026-10-11')).toBe('October 11th');
    expect(formatDateOrdinal('2026-10-12')).toBe('October 12th');
    expect(formatDateOrdinal('2026-10-13')).toBe('October 13th');
    expect(formatDateOrdinal('2026-10-21')).toBe('October 21st');
  });
});

describe('toDateTimeLocal', () => {
  it('slices an ISO string to what datetime-local wants', () => {
    expect(toDateTimeLocal('2026-05-11T14:15:00+02:00')).toBe('2026-05-11T14:15');
    expect(toDateTimeLocal('2026-05-11T14:15')).toBe('2026-05-11T14:15');
    expect(toDateTimeLocal(null)).toBe('');
  });
});

describe('byDateAsc', () => {
  it('sorts ascending and pushes missing/invalid dates last', () => {
    const items = [
      { id: 'c', checkIn: null },
      { id: 'b', checkIn: '2026-11-02T15:00' },
      { id: 'd', checkIn: 'not-a-date' },
      { id: 'a', checkIn: '2026-10-30T15:00' },
    ];
    expect([...items].sort(byDateAsc('checkIn')).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
