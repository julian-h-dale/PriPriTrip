import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import MuiTimeline from '@mui/lab/Timeline';
import { timelineOppositeContentClasses } from '@mui/lab/TimelineOppositeContent';
import dayjs from '../../utils/dayjs';
import DayTimelineItem from './DayTimelineItem';
import PointTimelineItem from './PointTimelineItem';
import PointDetailSheet from './PointDetailSheet';
import PointForm from '../Forms/PointForm';

export default function Timeline({ tripId, trip, expandedDayId, onExpandedDayChange }) {
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [addPointContext, setAddPointContext] = useState(null); // { dayId, initialValues }

  if (!trip) return null;

  const sortedDays = trip.days;

  // Derive the selected point from the fresh trip so an edit + automatic
  // refetch updates the open detail sheet instead of showing stale data.
  const selectedPoint = selectedPointId
    ? sortedDays.flatMap((day) => day.points).find((p) => p.pointId === selectedPointId) ?? null
    : null;

  const renderItems = [];
  sortedDays.forEach((day) => {
    renderItems.push({ item: day, isDay: true });
    if (expandedDayId === day.dayId) {
      const sortedPoints = day.points;
      sortedPoints.forEach((point) => {
        renderItems.push({ item: point, isDay: false });
      });
    }
  });

  return (
    <Box>
      <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
        <Typography variant="h5" component="h1" color="primary">
          {trip.tripName}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {dayjs(trip.startDate).format('MMM D')} – {dayjs(trip.endDate).format('MMM D, YYYY')}
        </Typography>
      </Box>

      <MuiTimeline
        sx={{
          [`& .${timelineOppositeContentClasses.root}`]: { flex: 0.25 },
          px: 1,
          py: 1,
          mt: 0,
        }}
      >
        <AnimatePresence initial={false}>
          {renderItems.map(({ item, isDay }, index) => {
            const isFirst = index === 0;
            const isLast = index === renderItems.length - 1;

            return isDay ? (
              <DayTimelineItem
                key={item.dayId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onToggle={() =>
                  onExpandedDayChange(expandedDayId === item.dayId ? null : item.dayId)
                }
                onAddPoint={(dayId) => {
                  const day = trip.days.find((d) => d.dayId === dayId);
                  if (day) setAddPointContext({ dayId, initialValues: { startDateTime: dayjs(day.date).format('YYYY-MM-DDTHH:mm') } });
                }}
              />
            ) : (
              <PointTimelineItem
                key={item.pointId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onSelect={(point) => setSelectedPointId(point?.pointId ?? null)}
              />
            );
          })}
        </AnimatePresence>
      </MuiTimeline>

      <PointDetailSheet
        tripId={tripId}
        item={selectedPoint}
        onClose={() => setSelectedPointId(null)}
      />

      <PointForm
        tripId={tripId}
        dayId={addPointContext?.dayId}
        open={!!addPointContext}
        initialValues={addPointContext?.initialValues}
        onClose={() => setAddPointContext(null)}
        onSaved={() => setAddPointContext(null)}
      />
    </Box>
  );
}
