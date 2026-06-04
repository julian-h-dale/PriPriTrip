import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import AddIcon from '@mui/icons-material/Add';
import ExploreIcon from '@mui/icons-material/Explore';

const NAV_ITEMS = [
  { label: 'Home', icon: <HomeIcon />, path: '/' },
  { label: 'New Trip', icon: <AddIcon />, path: '/new-trip' },
];

/**
 * AppLayout — shared AppBar + navigation drawer wrapper.
 *
 * Props:
 *   title    — string shown in the AppBar
 *   actions  — optional ReactNode rendered on the right of the AppBar
 *   children — page content rendered below the AppBar
 */
export default function AppLayout({ title, actions, children }) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <ExploreIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }} noWrap>
            {title}
          </Typography>
          {actions}
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: 240 }} role="presentation">
          <Box sx={{ px: 2, py: 2 }}>
            <Typography variant="h6" fontWeight={700}>
              PriPriTrip
            </Typography>
          </Box>
          <Divider />
          <List>
            {NAV_ITEMS.map(({ label, icon, path }) => (
              <ListItem key={label} disablePadding>
                <ListItemButton
                  onClick={() => {
                    setDrawerOpen(false);
                    navigate(path);
                  }}
                >
                  <ListItemIcon>{icon}</ListItemIcon>
                  <ListItemText primary={label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      {children}
    </Box>
  );
}
