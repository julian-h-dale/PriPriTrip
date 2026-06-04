import { motion } from 'framer-motion';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import { Box, Chip, IconButton, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CircleIcon from '@mui/icons-material/Circle';
import dayjs from '../../utils/dayjs';

const MotionTimelineItem = motion.create(TimelineItem);

export default function DayTimelineItem({ item, isFirst, isLast, onToggle, onAddPoint }) {
  return (
    <MotionTimelineItem
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={onToggle}
      sx={{ cursor: 'pointer' }}
    >
      <TimelineOppositeContent
        sx={{ m: 'auto 0', py: '10px' }}
        variant="body2"
        color="text.secondary"
      >
        {dayjs(item.date).format('MMM D')}
      </TimelineOppositeContent>

      <TimelineSeparator>
        <TimelineConnector sx={{ bgcolor: isFirst ? 'transparent' : 'grey.400' }} />
        <TimelineDot sx={{ bgcolor: 'grey.900', p: 0.5 }}>
          <CircleIcon sx={{ fontSize: 14, color: 'white' }} />
        </TimelineDot>
        <TimelineConnector sx={{ bgcolor: isLast ? 'transparent' : 'grey.400' }} />
      </TimelineSeparator>

      <TimelineContent sx={{ py: '10px', px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {item.title}
            </Typography>
            {item.description && (
              <Typography variant="body2" color="text.secondary">
                {item.description}
              </Typography>
            )}
          </Box>
          {item.isAlternate && (
            <Chip
              label="alt"
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0 }}
            />
          )}
          <IconButton
            size="small"
            color="primary"
            aria-label="Add point"
            onClick={(e) => { e.stopPropagation(); onAddPoint(item.dayId); }}
            sx={{ p: 0.25, flexShrink: 0 }}
          >
            <AddCircleOutlineIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      </TimelineContent>
    </MotionTimelineItem>
  );
}
