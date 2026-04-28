import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import MuiTimeline from '@mui/lab/Timeline';
import { timelineOppositeContentClasses } from '@mui/lab/TimelineOppositeContent';
import { useSelector } from 'react-redux';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';
import { selectTrip } from '../../store/tripSlice';
import GroupTimelineItem from './GroupTimelineItem';
import LegTimelineItem from './LegTimelineItem';
import LegDetailSheet from './LegDetailSheet';

export default function Timeline({ onEditGroup, onEditLeg, expandedGroupId, onExpandedGroupChange }) {
  const trip = useSelector(selectTrip);
  const [selectedLeg, setSelectedLeg] = useState(null);

  if (!trip) return null;

  const topGroups = trip.items
    .filter((i) => i.parentItemId === null && i.kind === 'group')
    .sort((a, b) => dayjs(a.startDateTime).tz(TRIP_TZ) - dayjs(b.startDateTime).tz(TRIP_TZ));

  const getChildren = (groupId) =>
    trip.items
      .filter((i) => i.parentItemId === groupId)
      .sort((a, b) => dayjs(a.startDateTime).tz(TRIP_TZ) - dayjs(b.startDateTime).tz(TRIP_TZ));

  // Flat render list: groups always present, legs spliced in after their parent when expanded
  const renderItems = [];
  topGroups.forEach((group) => {
    renderItems.push({ item: group, isGroup: true });
    if (expandedGroupId === group.itemId) {
      getChildren(group.itemId).forEach((child) => {
        renderItems.push({ item: child, isGroup: false });
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
          {renderItems.map(({ item, isGroup }, index) => {
            const isFirst = index === 0;
            const isLast = index === renderItems.length - 1;

            return isGroup ? (
              <GroupTimelineItem
                key={item.itemId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onToggle={() =>
                  onExpandedGroupChange(expandedGroupId === item.itemId ? null : item.itemId)
                }
                onEdit={onEditGroup}
              />
            ) : (
              <LegTimelineItem
                key={item.itemId}
                item={item}
                isFirst={isFirst}
                isLast={isLast}
                onSelect={setSelectedLeg}
                onEdit={onEditLeg}
              />
            );
          })}
        </AnimatePresence>
      </MuiTimeline>

      <LegDetailSheet
        item={selectedLeg}
        onClose={() => setSelectedLeg(null)}
        onEdit={onEditLeg}
      />
    </Box>
  );
}

