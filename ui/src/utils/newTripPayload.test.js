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

  it('builds a full trip payload with travels', () => {
    const payload = buildImportPayload({ tripDetails, outbound, returnLeg });

    expect(payload.tripName).toBe('Rome');
    expect(payload.tripId).toBeTruthy();
    expect(payload.stays).toEqual([]);
    expect(payload.days).toHaveLength(5);
    expect(payload.travels).toHaveLength(2);
    expect(payload.travels[0]).toMatchObject({
      name: 'Flight to Rome',
      mode: 'flight',
      departureDateTime: '2026-05-01T09:00',
    });
    expect(payload.travels[0].locations.map((l) => l.role)).toEqual(['origin', 'destination']);
  });

  it('sends no departure/arrival points — the backend generates those from the leg', () => {
    const payload = buildImportPayload({ tripDetails, outbound, returnLeg });
    // Sending our own is what put every flight on the timeline twice: once as
    // our point, once as the one detail_points.py derives from the same leg.
    expect(payload.days.flatMap((d) => d.points)).toEqual([]);
  });

  it('omits skipped legs', () => {
    const payload = buildImportPayload({
      tripDetails,
      outbound: { ...outbound, skipped: true },
      returnLeg,
    });
    expect(payload.travels).toHaveLength(1);
    expect(payload.travels[0].name).toBe('Flight home');
  });

  it('normalizes empty optional leg fields to null', () => {
    const payload = buildImportPayload({ tripDetails, outbound, returnLeg });
    expect(payload.travels[1].operator).toBeNull();
    expect(payload.travels[1].vehicleNumber).toBeNull();
  });
});
