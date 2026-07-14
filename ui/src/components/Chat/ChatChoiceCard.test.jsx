/**
 * "Which Sheraton did you mean?" (review.md 3F-5).
 *
 * The load-bearing property here is what crosses the wire. The assistant never
 * supplies coordinates — the backend resolves places itself — so a pick must send
 * an optionId or a placeId and nothing else. A test that only checked "onSubmit
 * was called" would happily pass while the component shipped a lat/lng the model
 * hallucinated.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatChoiceCard from './ChatChoiceCard';

const autocomplete = {
  suggestions: [],
  loading: false,
  onInputChange: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../../hooks/usePlacesAutocomplete', () => ({
  default: () => autocomplete,
  usePlacesAutocomplete: () => autocomplete,
}));

const CHOICE = {
  prompt: 'Which Sheraton did you mean?',
  options: [
    {
      optionId: 'place-0',
      label: 'Sheraton Grande Tokyo Bay',
      sublabel: 'Urayasu, Chiba',
      mapsUri: 'https://maps.google.com/?cid=1',
    },
    { optionId: 'place-1', label: 'Sheraton Miyako Tokyo', sublabel: 'Minato City' },
  ],
};

function renderCard(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ChatChoiceCard choice={CHOICE} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

describe('ChatChoiceCard', () => {
  beforeEach(() => {
    autocomplete.suggestions = [];
    autocomplete.loading = false;
    vi.clearAllMocks();
  });

  it('shows the prompt and every option', () => {
    renderCard();

    expect(screen.getByText('Which Sheraton did you mean?')).toBeInTheDocument();
    expect(screen.getByText('Sheraton Grande Tokyo Bay')).toBeInTheDocument();
    expect(screen.getByText('Urayasu, Chiba')).toBeInTheDocument();
    expect(screen.getByText('Sheraton Miyako Tokyo')).toBeInTheDocument();
  });

  it('sends only the optionId and label when you pick one', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCard();

    await user.click(screen.getByText('Sheraton Grande Tokyo Bay'));

    expect(onSubmit).toHaveBeenCalledWith({
      optionId: 'place-0',
      label: 'Sheraton Grande Tokyo Bay',
    });
  });

  it('offers a search box, because the place might be your brother’s house', async () => {
    // None of the options is right, and no assistant suggestion ever will be —
    // this is the escape hatch that makes the card safe to show at all.
    const user = userEvent.setup();
    autocomplete.suggestions = [
      { placeId: 'ChIJbrothers', description: '123 Elm St, Naha', mainText: '123 Elm St' },
    ];
    const { onSubmit } = renderCard();

    const search = screen.getByLabelText(/search for a different place/i);
    await user.click(search);
    await user.click(await screen.findByText('123 Elm St, Naha'));

    // The place id, not coordinates: the backend fetches the authoritative
    // details itself, exactly as it does for an option it offered.
    expect(onSubmit).toHaveBeenCalledWith({
      placeId: 'ChIJbrothers',
      label: '123 Elm St',
    });
  });

  it('surfaces a save failure instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ detail: 'That place is on another trip.' });
    render(<ChatChoiceCard choice={CHOICE} onSubmit={onSubmit} />);

    await user.click(screen.getByText('Sheraton Miyako Tokyo'));

    expect(await screen.findByText('That place is on another trip.')).toBeInTheDocument();
  });

  it('collapses to a summary once the place is saved', () => {
    renderCard({ savedSummary: 'Saved Sheraton Grande Tokyo Bay' });

    expect(screen.getByText('Saved Sheraton Grande Tokyo Bay')).toBeInTheDocument();
    // The options are gone: the question has been answered, and re-answering it
    // would overwrite the location with a second place.
    expect(screen.queryByText('Sheraton Miyako Tokyo')).not.toBeInTheDocument();
  });

  it('cannot be answered twice while a save is in flight', async () => {
    renderCard({ disabled: true });

    const [first] = screen.getAllByRole('button');
    expect(first).toHaveAttribute('aria-disabled', 'true');
  });
});
