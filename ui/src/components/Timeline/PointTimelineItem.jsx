import { motion } from 'framer-motion';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import { Box, Typography } from '@mui/material';
import { parseWallClock } from '../../utils/dayjs';
import { placeLabel } from '../../utils/format';

import { ROYAL_BLUE, getPointIcon } from '../../utils/pointIcons';

const MotionTimelineItem = motion.create(TimelineItem);


export default function PointTimelineItem({ item, isFirst, isLast, onSelect }) {
  const Icon = getPointIcon(item);
  // Generated points (check-in, departure) inherit the place from their stay or
  // travel leg, so "Check In: Hyatt" can say where the Hyatt actually is.
  const first = item.locations?.[0];
  const place = first ? placeLabel(first) : null;

  return (
    <MotionTimelineItem
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={() => onSelect?.(item)}
      sx={{ cursor: 'pointer' }}
    >
      <TimelineOppositeContent
        sx={{ m: 'auto 0', py: '10px' }}
        variant="body2"
        color="text.secondary"
      >
        {item.startDateTime
          ? parseWallClock(item.startDateTime).format('h:mm A')
          : null}
      </TimelineOppositeContent>

      <TimelineSeparator>
        <TimelineConnector sx={{ bgcolor: isFirst ? 'transparent' : 'grey.400' }} />
        <TimelineDot sx={{ bgcolor: ROYAL_BLUE, p: 0.5 }}>
          <Icon sx={{ fontSize: 14, color: 'white' }} />
        </TimelineDot>
        <TimelineConnector sx={{ bgcolor: isLast ? 'transparent' : 'grey.400' }} />
      </TimelineSeparator>

      <TimelineContent sx={{ py: '10px', px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" fontWeight={500}>
            {item.title}
          </Typography>
        </Box>
        {place && (
          <Typography variant="caption" color="text.secondary">
            {place}
          </Typography>
        )}
      </TimelineContent>
    </MotionTimelineItem>
  );
}
