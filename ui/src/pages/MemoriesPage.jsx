import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert,
  AppBar,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Fab,
  IconButton,
  Snackbar,
  Toolbar,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import {
  fetchMemories,
  deleteMemory,
  clearError,
  selectMemories,
  selectMemoriesStatus,
  selectMemoriesError,
} from '../store/memoriesSlice';
import { selectTrip } from '../store/tripSlice';
import MemoryForm from '../components/Forms/MemoryForm';

function formatDate(date, time) {
  if (!date) return '';
  const parts = [date];
  if (time) parts.push(time);
  return parts.join(' · ');
}

export default function MemoriesPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const memories = useSelector(selectMemories);
  const status = useSelector(selectMemoriesStatus);
  const error = useSelector(selectMemoriesError);
  const trip = useSelector(selectTrip);

  const [formOpen, setFormOpen] = useState(false);
  const [editMemory, setEditMemory] = useState(null);

  useEffect(() => {
    dispatch(fetchMemories());
  }, [dispatch]);

  // Build a lookup for itinerary leg titles (for the linked item badge)
  const itemTitleMap = Object.fromEntries(
    (trip?.items ?? []).map((i) => [i.itemId, i.title])
  );

  const isLoading = status === 'loading';
  const isError = status === 'error';

  const handleEdit = (memory) => {
    setEditMemory(memory);
    setFormOpen(true);
  };

  const handleDelete = (memoryId) => {
    if (window.confirm('Delete this memory?')) {
      dispatch(deleteMemory(memoryId));
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <IconButton
            color="inherit"
            size="small"
            onClick={() => navigate('/')}
            sx={{ mr: 1 }}
          >
            <ArrowBackIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Memories
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" disableGutters sx={{ pb: 10 }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {!isLoading && memories.length === 0 && (
          <Box sx={{ textAlign: 'center', pt: 8, px: 3 }}>
            <Typography variant="body1" color="text.secondary">
              No memories yet. Tap + to capture your first one.
            </Typography>
          </Box>
        )}

        <Box sx={{ px: 2, pt: 2 }}>
          {memories.map((memory) => (
            <Card key={memory.memoryId} sx={{ mb: 2 }} elevation={1}>
              <CardContent sx={{ pb: '12px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
                      {memory.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {formatDate(memory.date, memory.time)}
                      {memory.location ? ` · ${memory.location}` : ''}
                    </Typography>
                    {memory.linkedItemId && itemTitleMap[memory.linkedItemId] && (
                      <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 0.75 }}>
                        ↗ {itemTitleMap[memory.linkedItemId]}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, ml: 1, flexShrink: 0 }}>
                    <IconButton size="small" onClick={() => handleEdit(memory)} sx={{ p: 0.5 }}>
                      <EditIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(memory.memoryId)} sx={{ p: 0.5, color: 'error.main' }}>
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                </Box>

                {memory.notes && (
                  <Box
                    sx={{
                      mt: 0.5,
                      typography: 'body2',
                      color: 'text.secondary',
                      '& p': { m: 0, mb: 0.75 },
                      '& p:last-child': { mb: 0 },
                      '& ul, & ol': { pl: 2.5, mt: 0, mb: 0.75 },
                      '& li': { mb: 0.25 },
                      '& strong': { color: 'text.primary' },
                      '& code': { fontFamily: 'monospace', fontSize: '0.85em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.notes}</ReactMarkdown>
                  </Box>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      <Snackbar
        open={isError}
        autoHideDuration={5000}
        onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => dispatch(clearError())} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 24, right: 16 }}
        onClick={() => { setEditMemory(null); setFormOpen(true); }}
      >
        <AddIcon />
      </Fab>

      <MemoryForm
        open={formOpen}
        memory={editMemory}
        onClose={() => { setFormOpen(false); setEditMemory(null); }}
      />
    </Box>
  );
}
