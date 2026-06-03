import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import MuiTimeline from '@mui/lab/Timeline';
import { timelineOppositeContentClasses } from '@mui/lab/TimelineOppositeContent';
import { useSelector } from 'react-redux';
import dayjs from '../../utils/dayjs';
import { selectTrip } from '../../store/tripSlice';
import GroupTimelineItem from './GroupTimelineItem';
import LegTimelineItem from './LegTimelineItem';
import LegDetailSheet from './LegDetailSheet';

export default function Timeline({ expandedDayId, onExpandedDayChange }) {
  const trip = useSelector(selectTrip);
  const [selectedPoint, setSelectedPoint] = useState(null);

  if (!trip) return null;

  const sortedDays = [...trip.days].sort((a, b) => a.sortOrder - b.sortOrder);

  const renderItems = [];
  sortedDays.forEach((day) => {
    renderItems.push({ item: day, isDay: true });
    if (expandedDayId === day.dayId) {
      const sortedPoints = [...day.points].sort((a, b) => a.sortOrder - b.sortOrder);
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
              <GroupTimelineItem
                key={item.dayId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onToggle={() =>
                  onExpandedDayChange(expandedDayId === item.dayId ? null : item.dayId)
                }
              />
            ) : (
              <LegTimelineItem
                key={item.pointId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onSelect={setSelectedPoint}
              />
            );
          })}
        </AnimatePresence>
      </MuiTimeline>

      <LegDetailSheet
        item={selectedPoint}
        onClose={() => setSelectedPoint(null)}
      />
    </Box>
  );
}
