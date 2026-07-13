import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Typography } from '@mui/material';

import DetailTimelinePage from '../components/Timeline/DetailTimelinePage';
import TravelForm from '../components/Forms/TravelForm';
import { useGetTripQuery } from '../store/apiSlice';
import {
  byDateAsc,
  firstLocationByRole,
  formatDateTime,
  placeLabel,
  placeLocality,
} from '../utils/format';

export default function TravelDetailsPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { data: trip, isLoading, error } = useGetTripQuery(tripId, { skip: !tripId });
  const [editingTravel, setEditingTravel] = useState(null);

  const travels = useMemo(
    () => [...(trip?.travels ?? [])].sort(byDateAsc('departureDateTime')),
    [trip],
  );

  return (
    <DetailTimelinePage
      tripName={trip?.tripName}
      title="Travel details"
      subtitle="Read-only timeline ordered by departure date/time."
      noun="travel"
      onBack={() => navigate(`/trip/${tripId}`)}
      items={travels}
      isLoading={isLoading}
      error={error}
      errorText="Failed to load travel details."
      emptyText="No travel legs found for this trip."
      getKey={(travel, index) => travel.travelDetailId || `${travel.name}-${index}`}
      getTitle={(travel) => travel.name || 'Untitled travel leg'}
      getTime={(travel) => formatDateTime(travel.departureDateTime, 'No departure date')}
      onAdd={() => setEditingTravel({})}
      onEdit={setEditingTravel}
      renderDetails={(travel) => {
        const origin = firstLocationByRole(travel.locations, 'origin');
        const destination = firstLocationByRole(travel.locations, 'destination');
        return (
          <>
            <Typography variant="body2" color="text.secondary">
              Mode: {travel.mode || '—'}
            </Typography>
            <Typography variant="body2">
              {placeLabel(origin)} → {placeLabel(destination)}
            </Typography>
            {(placeLocality(origin) || placeLocality(destination)) && (
              <Typography variant="caption" color="text.secondary">
                {placeLocality(origin) ?? '—'} → {placeLocality(destination) ?? '—'}
              </Typography>
            )}
          </>
        );
      }}
    >
      {trip && (
        <TravelForm
          tripId={trip.tripId}
          open={!!editingTravel}
          initialValues={editingTravel || {}}
          onClose={() => setEditingTravel(null)}
          onSaved={() => setEditingTravel(null)}
        />
      )}
    </DetailTimelinePage>
  );
}
