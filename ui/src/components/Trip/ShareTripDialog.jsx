import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

import {
  useCreateTripShareMutation,
  useGetTripShareQuery,
  useRevokeTripShareMutation,
} from '../../store/apiSlice';

/**
 * The owner's control panel for a trip's share link (docs/share_links_plan.md).
 *
 * There is at most one link per trip, which is what makes "revoke" mean
 * something unambiguous. Creating is idempotent — tapping share twice hands back
 * the same URL rather than quietly invalidating the one already in someone's
 * messages.
 */
export default function ShareTripDialog({ tripId, open, onClose }) {
  const { data: share, isLoading, error } = useGetTripShareQuery(tripId, {
    skip: !open || !tripId,
  });
  const [createShare, { isLoading: creating }] = useCreateTripShareMutation();
  const [revokeShare, { isLoading: revoking }] = useRevokeTripShareMutation();
  const [copied, setCopied] = useState(false);

  // A trip that has never been shared 404s — that is "no link yet", not a fault.
  const notShared = error?.status === 404;
  const busy = isLoading || creating || revoking;

  async function copy() {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
    } catch {
      return; // clipboard blocked; the field is selectable, so they can copy by hand
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Share this trip</DialogTitle>

      <DialogContent>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!isLoading && (notShared || !share) && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Create a link that shows this itinerary to anyone who opens it — no account needed.
              They can read it; they can&apos;t change it. You can revoke the link at any time.
            </Typography>
            <Button
              variant="contained"
              fullWidth
              disabled={busy}
              onClick={() => createShare(tripId)}
            >
              {creating ? 'Creating…' : 'Create link'}
            </Button>
          </>
        )}

        {!isLoading && share && !notShared && (
          <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                size="small"
                value={share.url}
                label="Anyone with this link can view"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <IconButton
                onClick={copy}
                aria-label="Copy link"
                color={copied ? 'success' : 'default'}
                sx={{ mt: 0.5 }}
              >
                {copied ? <CheckIcon /> : <ContentCopyIcon />}
              </IconButton>
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {share.viewCount > 0
                ? `Opened ${share.viewCount} ${share.viewCount === 1 ? 'time' : 'times'}.`
                : 'Not opened yet.'}
            </Typography>

            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              The link includes your booking confirmation numbers, so your travel companion has
              them. Revoke it if it ends up somewhere you didn&apos;t intend.
            </Alert>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {share && !notShared && (
          <Button
            color="error"
            disabled={busy}
            onClick={async () => {
              await revokeShare(tripId);
            }}
          >
            {revoking ? 'Revoking…' : 'Revoke link'}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
