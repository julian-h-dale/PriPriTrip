import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Typography } from '@mui/material';

import DetailTimelinePage from '../components/Timeline/DetailTimelinePage';
import StayForm from '../components/Forms/StayForm';
import { useGetTripQuery } from '../store/apiSlice';
import {
  byDateAsc,
  firstLocationByRole,
  formatDateRange,
  formatDateTime,
  localityLabel,
} from '../utils/format';

export default function StayDetailsPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { data: trip, isLoading, error } = useGetTripQuery(tripId, { skip: !tripId });
  const [editingStay, setEditingStay] = useState(null);

  const stays = useMemo(
    () => [...(trip?.stays ?? [])].sort(byDateAsc('checkIn')),
    [trip],
  );

  return (
    <DetailTimelinePage
      tripName={trip?.tripName}
      title="Stay details"
      subtitle="Read-only timeline ordered by check-in date/time."
      noun="stay"
      onBack={() => navigate(`/trip/${tripId}`)}
      items={stays}
      isLoading={isLoading}
      error={error}
      errorText="Failed to load stay details."
      emptyText="No stays found for this trip."
      getKey={(stay, index) => stay.stayDetailId || `${stay.name}-${index}`}
      getTitle={(stay) => stay.name || 'Untitled stay'}
      getTime={(stay) => formatDateTime(stay.checkIn, 'No check-in date')}
      onAdd={() => setEditingStay({})}
      onEdit={setEditingStay}
      renderDetails={(stay) => {
        const venue = firstLocationByRole(stay.locations, 'venue') ?? (stay.locations ?? [])[0];
        return (
          <>
            <Typography variant="body2" color="text.secondary">
              {formatDateRange(stay.checkIn, stay.checkOut)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {localityLabel(venue)}
            </Typography>
          </>
        );
      }}
    >
      {trip && (
        <StayForm
          tripId={trip.tripId}
          open={!!editingStay}
          initialValues={editingStay || {}}
          onClose={() => setEditingStay(null)}
          onSaved={() => setEditingStay(null)}
        />
      )}
    </DetailTimelinePage>
  );
}
