import { Box, Typography } from '@mui/material';
import MuiTimeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
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

export default function Timeline() {
  const trip = useSelector(selectTrip);

  if (!trip) return null;

  // Only top-level groups (parentItemId === null, kind === 'group')
  const topGroups = trip.items
    .filter((i) => i.parentItemId === null && i.kind === 'group')
    .sort((a, b) => a.sortOrder - b.sortOrder);

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
        {topGroups.map((group, index) => (
          <TimelineItem key={group.itemId}>
            {/* Left side: start date */}
            <TimelineOppositeContent
              sx={{ m: 'auto 0', py: '10px' }}
              variant="body2"
              color="text.secondary"
            >
              {dayjs(group.startDateTime).format('MMM D')}
            </TimelineOppositeContent>

            <TimelineSeparator>
              <TimelineConnector sx={{ bgcolor: index === 0 ? 'transparent' : 'grey.400' }} />
              <TimelineDot variant="outlined" sx={{ borderColor: 'grey.800' }} />
              <TimelineConnector
                sx={{
                  bgcolor:
                    index === topGroups.length - 1 ? 'transparent' : 'grey.400',
                }}
              />
            </TimelineSeparator>

            <TimelineContent sx={{ py: '10px', px: 2 }}>
              <Typography variant="subtitle1" component="span">
                {group.title}
              </Typography>
              {group.description && (
                <Typography variant="body2" color="text.secondary">
                  {group.description}
                </Typography>
              )}
            </TimelineContent>
          </TimelineItem>
        ))}
      </MuiTimeline>
    </Box>
  );
}
