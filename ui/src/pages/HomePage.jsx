import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Snackbar,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  Toolbar,
  Typography,
} from '@mui/material';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import ExploreIcon from '@mui/icons-material/Explore';
import FavoriteIcon from '@mui/icons-material/Favorite';
import SaveIcon from '@mui/icons-material/Save';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import Timeline from '../components/Timeline/Timeline';
import GroupForm from '../components/Forms/GroupForm';
import LegForm from '../components/Forms/LegForm';
import {
  fetchTrip,
  saveTrip,
  clearError,
  selectTrip,
  selectTripStatus,
  selectTripError,
} from '../store/tripSlice';
import { useOnlineStatus } from '../utils/useOnlineStatus';

export default function HomePage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);
  const isOnline = useOnlineStatus();

  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupFormItem, setGroupFormItem] = useState(null);
  const [legFormOpen, setLegFormOpen] = useState(false);
  const [legFormItem, setLegFormItem] = useState(null);
  const [expandedGroupId, setExpandedGroupId] = useState(null);

  useEffect(() => {
    dispatch(fetchTrip());
  }, [dispatch]);

  const isSaving = status === 'saving';
  const isLoading = status === 'loading';
  const isError = status === 'error';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <ExploreIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            PriPriTrip
          </Typography>
          {!isOnline && (
            <Chip
              icon={<WifiOffIcon sx={{ fontSize: 14 }} />}
              label="Offline"
              size="small"
              sx={{
                mr: 1.5,
                height: 22,
                fontSize: '0.7rem',
                bgcolor: 'rgba(255,255,255,0.15)',
                color: 'inherit',
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          )}
          <Button
            size="small"
            color="inherit"
            startIcon={<FavoriteIcon sx={{ fontSize: 16 }} />}
            onClick={() => navigate('/memories')}
            sx={{ textTransform: 'none', minWidth: 80, mr: 0.5 }}
          >
            Memories
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={
              isSaving
                ? <CircularProgress size={14} color="inherit" />
                : <SaveIcon sx={{ fontSize: 16 }} />
            }
            onClick={() => dispatch(saveTrip())}
            disabled={isSaving || isLoading || !trip || !isOnline}
            sx={{ textTransform: 'none', minWidth: 72 }}
          >
            Save
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" disableGutters>
        {isLoading && !trip && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {isError && !trip && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error" onClose={() => dispatch(clearError())}>
              {error ?? 'Failed to load trip.'}
            </Alert>
          </Box>
        )}
        {trip && (
          <Timeline
            onEditGroup={(item) => { setGroupFormItem(item); setGroupFormOpen(true); }}
            onEditLeg={(item) => { setLegFormItem(item); setLegFormOpen(true); }}
            expandedGroupId={expandedGroupId}
            onExpandedGroupChange={setExpandedGroupId}
          />
        )}
      </Container>

      <Snackbar
        open={isError && !!trip}
        autoHideDuration={5000}
        onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => dispatch(clearError())}
          sx={{ width: '100%' }}
        >
          {error ?? 'Failed to save trip.'}
        </Alert>
      </Snackbar>

      {trip && (
        <SpeedDial
          ariaLabel="Add itinerary item"
          sx={{ position: 'fixed', bottom: 24, right: 16 }}
          icon={<SpeedDialIcon />}
        >
          <SpeedDialAction
            icon={<AddLocationAltIcon />}
            tooltipTitle="Add Leg"
            onClick={() => { setLegFormItem(null); setLegFormOpen(true); }}
          />
          <SpeedDialAction
            icon={<CreateNewFolderIcon />}
            tooltipTitle="Add Group"
            onClick={() => { setGroupFormItem(null); setGroupFormOpen(true); }}
          />
        </SpeedDial>
      )}

      <GroupForm
        open={groupFormOpen}
        item={groupFormItem}
        onClose={(saved) => {
          setGroupFormOpen(false);
          if (saved) setExpandedGroupId(saved.itemId);
        }}
      />
      <LegForm
        open={legFormOpen}
        item={legFormItem}
        onClose={(saved) => {
          setLegFormOpen(false);
          if (saved?.parentItemId) setExpandedGroupId(saved.parentItemId);
        }}
      />
    </Box>
  );
}
