/**
 * The card a traveller actually stares at, mid-trip (docs/active_trip_plan.md).
 *
 * Two of these tests pin bugs that shipped: the countdown once read "in 4h 60m",
 * and "Be at the airport by..." appeared on *arrivals* — telling you to get to
 * the airport for a flight you had just got off. Both were invisible until
 * someone looked at the screen, which is exactly what a render test does.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import NextUpCard from './NextUpCard';

const NOON = new Date('2026-10-30T12:00:00Z').getTime();

function point(overrides = {}) {
  return {
    pointId: 'p1',
    type: 'activity',
    title: 'Dinner at Hitoshi',
    startUtc: '2026-10-30T13:00:00Z',
    endUtc: null,
    ...overrides,
  };
}

function renderCard(props = {}) {
  const onDone = vi.fn();
  render(<NextUpCard point={point()} now={NOON} onDone={onDone} {...props} />);
  return { onDone };
}

describe('NextUpCard', () => {
  it('renders nothing when there is no next point', () => {
    const { container } = render(<NextUpCard point={null} now={NOON} onDone={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the title and how long until it', () => {
    renderCard();

    expect(screen.getByText('Dinner at Hitoshi')).toBeInTheDocument();
    expect(screen.getByText('in 1h')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('says "Now" for something already underway', () => {
    renderCard({
      point: point({
        startUtc: '2026-10-30T11:00:00Z',
        endUtc: '2026-10-30T14:00:00Z',
      }),
    });

    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('now')).toBeInTheDocument();
  });

  describe('the confirmation number', () => {
    it('is on the screen, not one tap into a detail page', async () => {
      renderCard({ point: point({ confirmationNumber: 'ABC123' }) });

      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    it('falls back to the travel leg the point was generated from', () => {
      renderCard({
        point: point({
          type: 'departure',
          confirmationNumber: null,
          travelDetail: { mode: 'flight', confirmationNumber: 'FLY-456' },
        }),
      });

      expect(screen.getByText('FLY-456')).toBeInTheDocument();
    });

    it('copies to the clipboard in one tap', async () => {
      // The complaint from the stopping-point doc, verbatim: the confirmation
      // number should be "one tap from the screen (not three)".
      const writeText = vi.fn().mockResolvedValue(undefined);
      // userEvent.setup() installs its own clipboard stub, so ours is applied
      // after it — otherwise we would be asserting on theirs.
      const user = userEvent.setup();
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

      renderCard({ point: point({ confirmationNumber: 'ABC123' }) });
      await user.click(screen.getByRole('button', { name: /copy confirmation/i }));

      expect(writeText).toHaveBeenCalledWith('ABC123');
      vi.unstubAllGlobals();
    });
  });

  describe('the leave-by hint', () => {
    it('tells you when to be at the airport for a departure', () => {
      renderCard({
        point: point({
          type: 'departure',
          title: 'Departure: Flight from ORD',
          startUtc: '2026-10-30T18:00:00Z',
          travelDetail: { mode: 'flight' },
        }),
      });

      expect(screen.getByText(/be at the airport by/i)).toBeInTheDocument();
    });

    it('does NOT tell you to get to the airport for an arrival', () => {
      // The bug: leaveByHint fired for any travel point, so landing in Naha
      // advised you to be at the airport two hours before you landed.
      renderCard({
        point: point({
          type: 'arrival',
          title: 'Arrival: Flight to OKA',
          startUtc: '2026-10-30T18:00:00Z',
          travelDetail: { mode: 'flight' },
        }),
      });

      expect(screen.queryByText(/be at the airport by/i)).not.toBeInTheDocument();
    });
  });

  it('hands the point back when you tick it off', async () => {
    const user = userEvent.setup();
    const { onDone } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ pointId: 'p1' }));
  });

  it('will not let you double-tap Done while the save is in flight', () => {
    renderCard({ busy: true });

    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });
});
