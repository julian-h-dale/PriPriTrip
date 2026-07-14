/**
 * The screen for a trip you are ON (docs/active_trip_plan.md).
 *
 * It shows the next thing. That is the whole screen. These tests pin the two
 * behaviours that make it a screen rather than a filtered timeline: the thing
 * that is happening *now* wins over the thing that is merely next, and ticking
 * one off advances to the following one.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WhatsNextView from './WhatsNextView';

const { usePatchPointMutation, patchPoint } = vi.hoisted(() => {
  const patchPoint = vi.fn(() => ({ unwrap: () => Promise.resolve() }));
  return { usePatchPointMutation: vi.fn(), patchPoint };
});

vi.mock('../../store/apiSlice', () => ({ usePatchPointMutation }));

// The detail sheet is its own unit, and it drags the whole store in with it.
vi.mock('../Timeline/PointDetailSheet', () => ({ default: () => null }));

const NOON = new Date('2026-10-30T12:00:00Z');

const TRIP = {
  days: [
    {
      dayId: 'd1',
      points: [
        {
          pointId: 'p-breakfast',
          type: 'activity',
          title: 'Breakfast',
          startUtc: '2026-10-30T08:00:00Z',
          completed: true,
        },
        {
          pointId: 'p-checkin',
          type: 'check_in',
          title: 'Check in: Hyatt Regency Naha',
          startUtc: '2026-10-30T13:00:00Z',
        },
        {
          pointId: 'p-dinner',
          type: 'activity',
          title: 'Dinner at Hitoshi',
          startUtc: '2026-10-30T19:00:00Z',
        },
      ],
    },
  ],
};

describe('WhatsNextView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOON);
    vi.clearAllMocks();
    usePatchPointMutation.mockReturnValue([patchPoint, { isLoading: false }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the next thing, and skips what you have already done', () => {
    render(<WhatsNextView tripId="trip-1" trip={TRIP} onViewItinerary={vi.fn()} />);

    expect(screen.getByText('Check in: Hyatt Regency Naha')).toBeInTheDocument();
    // Breakfast is done and behind you; it is not the "next" thing.
    expect(screen.queryByText('Breakfast')).not.toBeInTheDocument();
  });

  it('lists what comes after it', () => {
    render(<WhatsNextView tripId="trip-1" trip={TRIP} onViewItinerary={vi.fn()} />);

    expect(screen.getByText('Dinner at Hitoshi')).toBeInTheDocument();
  });

  it('gives you the thing happening NOW over the thing that is merely next', () => {
    // You want the boarding pass while you are boarding, not the hotel you
    // check into afterwards.
    const boarding = {
      days: [
        {
          dayId: 'd1',
          points: [
            {
              pointId: 'p-flight',
              type: 'departure',
              title: 'Departure: Flight from ORD',
              startUtc: '2026-10-30T11:30:00Z',
              endUtc: '2026-10-30T12:30:00Z',
            },
            ...TRIP.days[0].points,
          ],
        },
      ],
    };
    render(<WhatsNextView tripId="trip-1" trip={boarding} onViewItinerary={vi.fn()} />);

    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Departure: Flight from ORD')).toBeInTheDocument();
    // The check-in is later, so it drops to the THEN list rather than the card.
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('marks the point done — completed, with the time you did it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WhatsNextView tripId="trip-1" trip={TRIP} onViewItinerary={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(patchPoint).toHaveBeenCalledWith({
      tripId: 'trip-1',
      pointId: 'p-checkin',
      patch: {
        completed: true,
        completedDateTime: NOON.toISOString(),
      },
    });
  });

  it('celebrates rather than showing an empty list when the trip is done', () => {
    const finished = {
      days: [
        {
          dayId: 'd1',
          points: [
            {
              pointId: 'p-breakfast',
              title: 'Breakfast',
              startUtc: '2026-10-30T08:00:00Z',
              completed: true,
            },
          ],
        },
      ],
    };
    render(<WhatsNextView tripId="trip-1" trip={finished} onViewItinerary={vi.fn()} />);

    expect(screen.getByText('Nothing else scheduled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('tells you when you are looking at a cached copy', () => {
    render(<WhatsNextView tripId="trip-1" trip={TRIP} offline onViewItinerary={vi.fn()} />);

    expect(screen.getByText(/showing your saved copy/i)).toBeInTheDocument();
  });

  it('always offers a way back to the full itinerary', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onViewItinerary = vi.fn();
    render(<WhatsNextView tripId="trip-1" trip={TRIP} onViewItinerary={onViewItinerary} />);

    await user.click(screen.getByRole('button', { name: /view full itinerary/i }));

    expect(onViewItinerary).toHaveBeenCalled();
  });
});
