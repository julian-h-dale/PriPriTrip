import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import MuiTimeline from '@mui/lab/Timeline';
import { timelineOppositeContentClasses } from '@mui/lab/TimelineOppositeContent';
import { useSelector } from 'react-redux';
import dayjs from '../../utils/dayjs';
import { selectTrip } from '../../store/tripSlice';
import DayTimelineItem from './DayTimelineItem';
import PointTimelineItem from './PointTimelineItem';
import PointDetailSheet from './PointDetailSheet';

export default function Timeline({ expandedDayId, onExpandedDayChange }) {
  const trip = useSelector(selectTrip);
  const [selectedPoint, setSelectedPoint] = useState(null);

  if (!trip) return null;

  const sortedDays = trip.days;

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
              />
            ) : (
              <PointTimelineItem
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

      <PointDetailSheet
        item={selectedPoint}
        onClose={() => setSelectedPoint(null)}
      />
    </Box>
  );
}
