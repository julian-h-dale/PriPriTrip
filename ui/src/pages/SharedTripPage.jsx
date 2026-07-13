import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Container,
  Toolbar,
  Typography,
} from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import VisibilityIcon from '@mui/icons-material/Visibility';

import Timeline from '../components/Timeline/Timeline';
import { useGetSharedTripQuery } from '../store/apiSlice';

/**
 * A trip seen through a share link (docs/share_links_plan.md).
 *
 * This is the one page that renders with **no account** — it is outside
 * ProtectedRoute, and it deliberately reuses the owner's Timeline in `readOnly`
 * mode rather than growing a second, drifting copy of it. No trip id is passed,
 * so there is nothing for a stray write to aim at even if one slipped through.
 */
export default function SharedTripPage() {
  const { token } = useParams();
  const { data: trip, isLoading, error } = useGetSharedTripQuery(token, { skip: !token });
  const [expandedDayId, setExpandedDayId] = useState(null);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky">
        <Toolbar>
          <ExploreIcon sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
            PriPriTrip
          </Typography>
          <Chip
            icon={<VisibilityIcon sx={{ fontSize: 14 }} />}
            label="Shared view"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              bgcolor: 'rgba(255,255,255,0.15)',
              color: 'inherit',
              '& .MuiChip-icon': { color: 'inherit' },
            }}
          />
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" disableGutters>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Unknown, revoked and expired all arrive here identically — the server
            will not tell us which, and neither will we. */}
        {!!error && (
          <Box sx={{ p: 2 }}>
            <Alert severity="warning">
              This link is no longer active. Ask whoever shared the trip for a new one.
            </Alert>
          </Box>
        )}

        {trip && (
          <>
            <Timeline
              trip={trip}
              readOnly
              expandedDayId={expandedDayId}
              onExpandedDayChange={setExpandedDayId}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', textAlign: 'center', px: 3, py: 4 }}
            >
              You&apos;re viewing a shared itinerary. It updates as the owner changes it, and they
              can revoke this link at any time.
            </Typography>
          </>
        )}
      </Container>
    </Box>
  );
}
