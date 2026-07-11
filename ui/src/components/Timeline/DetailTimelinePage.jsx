/**
 * Shared chrome for the Stay/Travel detail timelines (review.md 2C-1).
 *
 * StayDetailsPage and TravelDetailsPage were ~90% identical — same layout,
 * loading/error/empty states, and timeline markup, differing only in labels,
 * the sort field, what each card shows, and which form opens. Those are the
 * props below; everything else lives here once.
 */

import {
  Alert,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import MuiTimeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineOppositeContent, {
  timelineOppositeContentClasses,
} from '@mui/lab/TimelineOppositeContent';

import AppLayout from '../AppLayout';
import { getErrorMessage } from '../../utils/errors';

export default function DetailTimelinePage({
  // page chrome
  tripName,
  title,
  subtitle,
  noun, // "stay" / "travel" — used for aria-labels
  onBack,
  // data
  items,
  isLoading,
  error,
  errorText,
  emptyText,
  // per-item rendering
  getKey,
  getTitle,
  getTime,
  renderDetails,
  // actions
  onAdd,
  onEdit,
  // the edit/create form; the caller decides when it is renderable
  children,
}) {
  return (
    <AppLayout title={tripName ?? title} onBack={onBack}>
      <Container maxWidth="sm" disableGutters>
        <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5" component="h1" color="primary">
              {title}
            </Typography>
            <IconButton size="small" aria-label={`Add ${noun}`} onClick={onAdd}>
              <AddIcon />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        </Box>

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {!!error && !items?.length && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error">{getErrorMessage(error, errorText)}</Alert>
          </Box>
        )}

        {!isLoading && !error && items?.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="text.secondary">{emptyText}</Typography>
            </Paper>
          </Box>
        )}

        {items?.length > 0 && (
          <MuiTimeline
            sx={{
              [`& .${timelineOppositeContentClasses.root}`]: { flex: 0.38 },
              px: 1,
              py: 1,
              mt: 0,
            }}
          >
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return (
                <TimelineItem key={getKey(item, index)}>
                  <TimelineOppositeContent color="text.secondary" sx={{ fontSize: '0.8rem', pt: 2 }}>
                    {getTime(item)}
                  </TimelineOppositeContent>
                  <TimelineSeparator>
                    <TimelineDot color="primary" />
                    {!isLast && <TimelineConnector />}
                  </TimelineSeparator>
                  <TimelineContent sx={{ pb: 2 }}>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 1,
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {getTitle(item)}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label={`Edit ${noun}`}
                          onClick={() => onEdit(item)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      {renderDetails(item)}
                    </Paper>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </MuiTimeline>
        )}

        {children}
      </Container>
    </AppLayout>
  );
}
