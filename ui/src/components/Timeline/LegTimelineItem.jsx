import { motion } from 'framer-motion';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import { Box, IconButton, Typography } from '@mui/material';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';

import EditIcon from '@mui/icons-material/Edit';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import TrainIcon from '@mui/icons-material/Train';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import HotelIcon from '@mui/icons-material/Hotel';
import HomeIcon from '@mui/icons-material/Home';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import HikingIcon from '@mui/icons-material/Hiking';
import MuseumIcon from '@mui/icons-material/Museum';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import ExploreIcon from '@mui/icons-material/Explore';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import PlaceIcon from '@mui/icons-material/Place';

const MotionTimelineItem = motion.create(TimelineItem);

const ROYAL_BLUE = '#4169e1';

const SUBTYPE_ICON_MAP = {
  flight: FlightTakeoffIcon,
  train: TrainIcon,
  bus: DirectionsBusIcon,
  car: DirectionsCarIcon,
  ferry: DirectionsBoatIcon,
  boat: DirectionsBoatIcon,
  hotel: HotelIcon,
  hostel: HotelIcon,
  airbnb: HomeIcon,
  rental: HomeIcon,
  walk: DirectionsWalkIcon,
  hike: HikingIcon,
  museum: MuseumIcon,
  restaurant: RestaurantIcon,
  tour: ExploreIcon,
  activity: LocalActivityIcon,
};

function getSubtypeIcon(subtype) {
  return SUBTYPE_ICON_MAP[subtype?.toLowerCase()] ?? PlaceIcon;
}

export default function LegTimelineItem({ item, isFirst, isLast, onSelect, onEdit }) {
  const SubtypeIcon = getSubtypeIcon(item.subtype);

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
        {dayjs(item.startDateTime).tz(TRIP_TZ).format('h:mm A')}
      </TimelineOppositeContent>

      <TimelineSeparator>
        <TimelineConnector sx={{ bgcolor: isFirst ? 'transparent' : 'grey.400' }} />
        <TimelineDot sx={{ bgcolor: ROYAL_BLUE, p: 0.5 }}>
          <SubtypeIcon sx={{ fontSize: 14, color: 'white' }} />
        </TimelineDot>
        <TimelineConnector sx={{ bgcolor: isLast ? 'transparent' : 'grey.400' }} />
      </TimelineSeparator>

      <TimelineContent sx={{ py: '10px', px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2" fontWeight={500}>
            {item.title}
          </Typography>
          {onEdit && (
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onEdit(item); }}
              sx={{ ml: 0.5, opacity: 0.45, '&:hover': { opacity: 1 } }}
            >
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </TimelineContent>
    </MotionTimelineItem>
  );
}
