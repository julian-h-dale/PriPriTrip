/**
 * "3 things missing" — and a one-tap way to fix each (docs/july_11_stop.md #2).
 *
 * The banner is only ever allowed to appear when it has something to say. An
 * empty "0 things missing" alert on a finished trip is worse than no banner,
 * because it trains you to dismiss the thing without reading it.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TripGapsBanner from './TripGapsBanner';

const { useGetTripGapsQuery, useSubmitTripGapMutation } = vi.hoisted(() => ({
  useGetTripGapsQuery: vi.fn(),
  useSubmitTripGapMutation: vi.fn(),
}));

vi.mock('../../store/apiSlice', () => ({
  useGetTripGapsQuery,
  useSubmitTripGapMutation,
}));

const FLIGHT_GAP = {
  gapId: 'travel:1:times',
  target: 'travel',
  recordId: 'travel-1',
  severity: 'blocking',
  message: 'Flight to Naha has no departure time',
  form: {
    title: 'Flight to Naha',
    fields: [
      { name: 'departureDateTime', label: 'Departure', type: 'datetime', value: null },
    ],
  },
};

const CONFIRMATION_GAP = {
  gapId: 'stay:1:confirmation',
  target: 'stay',
  recordId: 'stay-1',
  severity: 'worth_adding',
  message: 'Hyatt Regency Naha has no confirmation number',
  form: { title: 'Hyatt Regency Naha', fields: [] },
};

function mockGaps(data, { isLoading = false } = {}) {
  useGetTripGapsQuery.mockReturnValue({ data, isLoading });
}

describe('TripGapsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSubmitTripGapMutation.mockReturnValue([vi.fn(() => ({ unwrap: () => Promise.resolve() }))]);
  });

  it('stays out of the way while the gaps are loading', () => {
    mockGaps(undefined, { isLoading: true });
    const { container } = render(<TripGapsBanner tripId="trip-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing at all when the trip is complete', () => {
    mockGaps({ gaps: [], blockingCount: 0, totalCount: 0 });
    const { container } = render(<TripGapsBanner tripId="trip-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('counts the gaps, and says how many actually block the trip', () => {
    mockGaps({ gaps: [FLIGHT_GAP, CONFIRMATION_GAP], blockingCount: 1, totalCount: 2 });
    render(<TripGapsBanner tripId="trip-1" />);

    expect(screen.getByText('2 things missing')).toBeInTheDocument();
    expect(screen.getByText('1 needed')).toBeInTheDocument();
    expect(screen.getByText('Flight to Naha has no departure time')).toBeInTheDocument();
  });

  it('says "1 thing missing", not "1 things missing"', () => {
    mockGaps({ gaps: [FLIGHT_GAP], blockingCount: 1, totalCount: 1 });
    render(<TripGapsBanner tripId="trip-1" />);

    expect(screen.getByText('1 thing missing')).toBeInTheDocument();
  });

  it('reassures you when nothing is urgent', () => {
    mockGaps({ gaps: [CONFIRMATION_GAP], blockingCount: 0, totalCount: 1 });
    render(<TripGapsBanner tripId="trip-1" />);

    expect(screen.getByText(/nothing here blocks the trip/i)).toBeInTheDocument();
    expect(screen.queryByText(/needed/)).not.toBeInTheDocument();
  });

  it('opens the form for a gap when you tap it', async () => {
    const user = userEvent.setup();
    mockGaps({ gaps: [FLIGHT_GAP], blockingCount: 1, totalCount: 1 });
    render(<TripGapsBanner tripId="trip-1" />);

    await user.click(screen.getByText('Flight to Naha has no departure time'));

    // The form came from the server — the client never decides the field types.
    expect(await screen.findByLabelText(/departure/i)).toBeInTheDocument();
  });

  it('can be dismissed, and stays dismissed', async () => {
    const user = userEvent.setup();
    mockGaps({ gaps: [FLIGHT_GAP], blockingCount: 1, totalCount: 1 });
    render(<TripGapsBanner tripId="trip-1" />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText('1 thing missing')).not.toBeInTheDocument();
  });
});
