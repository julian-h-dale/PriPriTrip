import { describe, expect, it } from 'vitest';

import {
  byDateAsc,
  firstLocationByRole,
  formatDate,
  formatDateOrdinal,
  formatDateRange,
  formatDateTime,
  placeLabel,
  placeLocality,
  toDateTimeLocal,
} from './format';

describe('placeLabel', () => {
  it('names the place', () => {
    expect(placeLabel({ name: 'Hyatt Regency', fullAddress: '3-6-20 Makishi, Naha, Okinawa, Japan' }))
      .toBe('Hyatt Regency');
  });

  it('names an airport instead of reciting its post code', () => {
    // The old helper took the last two parts of the address and rendered this
    // leg as "IL 60666, USA - TX 77032, USA".
    const ord = { name: 'ORD', fullAddress: "10000 W O'Hare Ave, Chicago, IL 60666, USA" };
    expect(placeLabel(ord)).toBe('ORD');
  });

  it('falls back to the street when a place has an address but no name', () => {
    expect(placeLabel({ fullAddress: '1-2-3 Shuri, Naha, Okinawa, Japan' })).toBe('1-2-3 Shuri');
  });

  it('returns an em dash for nothing at all', () => {
    expect(placeLabel(null)).toBe('—');
    expect(placeLabel({})).toBe('—');
  });
});

describe('placeLocality', () => {
  it('reduces a full address to where in the world it is', () => {
    expect(placeLocality({ fullAddress: '1-2-3 Shuri, Naha, Okinawa, Japan' })).toBe('Okinawa, Japan');
  });

  it('is null when there is no address to reduce', () => {
    expect(placeLocality({ name: 'Brother\'s place' })).toBeNull();
    expect(placeLocality({ fullAddress: 'Japan' })).toBeNull();
    expect(placeLocality(null)).toBeNull();
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
