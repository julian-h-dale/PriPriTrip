import { motion } from 'framer-motion';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import { Box, Typography } from '@mui/material';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';

import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import TrainIcon from '@mui/icons-material/Train';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import HotelIcon from '@mui/icons-material/Hotel';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import ExploreIcon from '@mui/icons-material/Explore';
import PlaceIcon from '@mui/icons-material/Place';

const MotionTimelineItem = motion.create(TimelineItem);

const ROYAL_BLUE = '#4169e1';

const TRAVEL_MODE_ICON = {
  flight: FlightTakeoffIcon,
  train: TrainIcon,
  bus: DirectionsBusIcon,
  car: DirectionsCarIcon,
  ferry: DirectionsBoatIcon,
  other: ExploreIcon,
};

function getPointIcon(point) {
  if (point.travelDetail?.mode) {
    return TRAVEL_MODE_ICON[point.travelDetail.mode] ?? PlaceIcon;
  }
  if (point.type === 'stay') return HotelIcon;
  if (point.type === 'activity') return LocalActivityIcon;
  return PlaceIcon;
}

export default function PointTimelineItem({ item, isFirst, isLast, onSelect }) {
  const Icon = getPointIcon(item);

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
          ? dayjs(item.startDateTime).tz(TRIP_TZ).format('h:mm A')
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
      </TimelineContent>
    </MotionTimelineItem>
  );
}
