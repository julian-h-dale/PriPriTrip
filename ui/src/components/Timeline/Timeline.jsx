import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import MuiTimeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';

const MotionTimelineItem = motion.create(TimelineItem);
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent, {
  timelineOppositeContentClasses,
} from '@mui/lab/TimelineOppositeContent';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { selectTrip } from '../../store/tripSlice';

const ROYAL_BLUE = '#4169e1';

export default function Timeline() {
  const trip = useSelector(selectTrip);
  const [expandedId, setExpandedId] = useState(null);

  if (!trip) return null;

  const topGroups = trip.items
    .filter((i) => i.parentItemId === null && i.kind === 'group')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getChildren = (groupId) =>
    trip.items
      .filter((i) => i.parentItemId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  // Build flat list: groups always present, legs inserted after their parent when expanded
  const renderItems = [];
  topGroups.forEach((group) => {
    renderItems.push({ item: group, isGroup: true });
    if (expandedId === group.itemId) {
      getChildren(group.itemId).forEach((child) => {
        renderItems.push({ item: child, isGroup: false });
      });
    }
  });

  return (
    <Box>
      {/* Trip header */}
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
          [`& .${timelineOppositeContentClasses.root}`]: {
            flex: 0.25,
          },
          px: 1,
          py: 1,
          mt: 0,
        }}
      >
        <AnimatePresence initial={false}>
          {renderItems.map(({ item, isGroup }, index) => {
            const isFirst = index === 0;
            const isLast = index === renderItems.length - 1;

            return (
              <MotionTimelineItem
                key={item.itemId}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onClick={isGroup ? () => setExpandedId((prev) => (prev === item.itemId ? null : item.itemId)) : undefined}
                sx={{ cursor: isGroup ? 'pointer' : 'default' }}
              >
              <TimelineOppositeContent
                sx={{ m: 'auto 0', py: '10px' }}
                variant="body2"
                color="text.secondary"
              >
                {isGroup
                  ? dayjs(item.startDateTime).format('MMM D')
                  : dayjs(item.startDateTime).format('h:mm A')}
              </TimelineOppositeContent>

              <TimelineSeparator>
                <TimelineConnector sx={{ bgcolor: isFirst ? 'transparent' : 'grey.400' }} />
                {isGroup ? (
                  <TimelineDot variant="outlined" sx={{ borderColor: 'grey.800' }} />
                ) : (
                  <TimelineDot sx={{ bgcolor: ROYAL_BLUE, boxShadow: 'none' }} />
                )}
                <TimelineConnector sx={{ bgcolor: isLast ? 'transparent' : 'grey.400' }} />
              </TimelineSeparator>

              <TimelineContent sx={{ py: '10px', px: 2 }}>
                <Typography
                  variant={isGroup ? 'subtitle1' : 'body2'}
                  fontWeight={isGroup ? 600 : 400}
                >
                  {item.title}
                </Typography>
                {isGroup && item.description && (
                  <Typography variant="body2" color="text.secondary">
                    {item.description}
                  </Typography>
                )}
              </TimelineContent>
            </MotionTimelineItem>
            );
          })}
        </AnimatePresence>
      </MuiTimeline>
    </Box>
  );
}
