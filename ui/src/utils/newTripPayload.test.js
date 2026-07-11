import { describe, expect, it } from 'vitest';
import { buildDays, buildImportPayload, routeLocations } from './newTripPayload';

describe('buildDays', () => {
  it('builds one day per calendar day, inclusive of both ends', () => {
    const days = buildDays('2026-05-01', '2026-05-04');
    expect(days).toHaveLength(4);
    expect(days[0].date).toBe('2026-05-01');
    expect(days[3].date).toBe('2026-05-04');
  });

  it('numbers and titles days with ordinal dates', () => {
    const days = buildDays('2026-05-01', '2026-05-03');
    expect(days[0].title).toBe('Day 1 — May 1st');
    expect(days[1].title).toBe('Day 2 — May 2nd');
    expect(days[2].title).toBe('Day 3 — May 3rd');
  });

  it('returns a single day when start equals end', () => {
    const days = buildDays('2026-05-01', '2026-05-01');
    expect(days).toHaveLength(1);
    expect(days[0].points).toEqual([]);
    expect(days[0].dayId).toBeTruthy();
  });
});

describe('routeLocations', () => {
  it('parses origin and destination from an arrow route', () => {
    const locs = routeLocations('LHR → FCO');
    expect(locs).toHaveLength(2);
    expect(locs[0]).toMatchObject({ name: 'LHR', role: 'origin' });
    expect(locs[1]).toMatchObject({ name: 'FCO', role: 'destination' });
  });

  it('marks middle stops as waypoints', () => {
    const locs = routeLocations('LHR - AMS - FCO');
    expect(locs.map((l) => l.role)).toEqual(['origin', 'waypoint', 'destination']);
  });

  it('returns an empty array for a missing route', () => {
    expect(routeLocations('')).toEqual([]);
    expect(routeLocations(null)).toEqual([]);
  });
});

describe('buildImportPayload', () => {
  const tripDetails = {
    tripName: 'Rome',
    startDate: '2026-05-01',
    endDate: '2026-05-05',
  };
  const outbound = {
    skipped: false,
    mode: 'flight',
    title: 'Flight to Rome',
    route: 'LHR → FCO',
    departureDateTime: '2026-05-01T09:00',
    arrivalDateTime: '2026-05-01T13:00',
    operator: 'BA',
    vehicleNumber: 'BA0552',
  };
  const returnLeg = {
    skipped: false,
    mode: 'flight',
    title: 'Flight home',
    route: 'FCO → LHR',
    departureDateTime: '2026-05-05T18:00',
    arrivalDateTime: '2026-05-05T20:00',
    operator: '',
    vehicleNumber: '',
  };

  it('builds a full trip payload with travels and generated points', () => {
    const payload = buildImportPayload({ tripDetails, outbound, returnLeg });

    expect(payload.tripName).toBe('Rome');
    expect(payload.tripId).toBeTruthy();
    expect(payload.stays).toEqual([]);
    expect(payload.days).toHaveLength(5);
    expect(payload.travels).toHaveLength(2);

    // Departure/arrival points land on the day matching their date.
    const day1 = payload.days[0];
    expect(day1.points).toHaveLength(2);
    expect(day1.points[0]).toMatchObject({
      type: 'departure',
      title: 'Departure: Flight to Rome',
      isSystemCreated: true,
      dayId: day1.dayId,
    });
    const lastDay = payload.days[4];
    expect(lastDay.points.map((p) => p.type)).toEqual(['departure', 'arrival']);

    // Points reference their travel detail.
    expect(day1.points[0].travelDetailId).toBe(payload.travels[0].travelDetailId);
    expect(payload.travels[0].locations.map((l) => l.role)).toEqual(['origin', 'destination']);
  });

  it('omits skipped legs and their points', () => {
    const payload = buildImportPayload({
      tripDetails,
      outbound: { ...outbound, skipped: true },
      returnLeg,
    });
    expect(payload.travels).toHaveLength(1);
    expect(payload.travels[0].name).toBe('Flight home');
    expect(payload.days[0].points).toEqual([]);
  });

  it('normalizes empty optional leg fields to null', () => {
    const payload = buildImportPayload({ tripDetails, outbound, returnLeg });
    expect(payload.travels[1].operator).toBeNull();
    expect(payload.travels[1].vehicleNumber).toBeNull();
  });
});
