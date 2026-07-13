import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import ListAltIcon from '@mui/icons-material/ListAlt';
import CelebrationIcon from '@mui/icons-material/Celebration';

import NextUpCard from './NextUpCard';
import ThenList from './ThenList';
import PointDetailSheet from '../Timeline/PointDetailSheet';
import { usePatchPointMutation } from '../../store/apiSlice';
import { followingPoints, nextPoint } from '../../utils/tripClock';

// The countdown has to move, or the screen is just a filtered timeline.
const TICK_MS = 30_000;

/**
 * The screen for a trip you are ON (docs/active_trip_plan.md).
 *
 * It shows the next thing. That is the whole screen — there is no "today", no
 * day-of-trip counter, no date grouping. Those were date manipulation dressed up
 * as features, and cutting them removed the timezone problem rather than solving
 * it.
 */
export default function WhatsNextView({ tripId, trip, offline = false, onViewItinerary }) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [patchPoint, { isLoading: saving }] = usePatchPointMutation();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const next = useMemo(() => nextPoint(trip, now), [trip, now]);
  const then = useMemo(() => followingPoints(trip, next), [trip, next]);

  const selectedPoint = selectedPointId
    ? (trip?.days ?? []).flatMap((d) => d.points ?? []).find((p) => p.pointId === selectedPointId)
    : null;

  async function markDone(point) {
    // `completed` is one of the two fields you may set even on a generated point
    // (app/services/detail_points.py USER_OWNED_POINT_FIELDS), so ticking a
    // check-in off needs no new backend at all.
    await patchPoint({
      tripId,
      pointId: point.pointId,
      patch: { completed: true, completedDateTime: new Date().toISOString() },
    }).unwrap();
    // The cache invalidation refetches the trip; `next` then moves on by itself.
  }

  return (
    <Box sx={{ px: 2, pt: 2, pb: 6 }}>
      {offline && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Showing your saved copy — you&apos;re offline.
        </Alert>
      )}

      {next ? (
        <>
          <NextUpCard point={next} now={now} onDone={markDone} busy={saving} />
          <ThenList points={then} onSelect={(p) => setSelectedPointId(p.pointId)} />
        </>
      ) : (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
          <CelebrationIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Nothing else scheduled
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Enjoy the trip.
          </Typography>
        </Paper>
      )}

      <Button
        fullWidth
        variant="text"
        startIcon={<ListAltIcon />}
        onClick={onViewItinerary}
        sx={{ mt: 3 }}
      >
        View full itinerary
      </Button>

      <PointDetailSheet
        tripId={tripId}
        item={selectedPoint}
        onClose={() => setSelectedPointId(null)}
      />
    </Box>
  );
}
