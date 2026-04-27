import { Box, AppBar, Toolbar, Typography, Container } from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import Timeline from '../components/Timeline/Timeline';

export default function HomePage() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <ExploreIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="h6" component="div">
            PriPriTrip
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" disableGutters>
        <Timeline />
      </Container>
    </Box>
  );
}
