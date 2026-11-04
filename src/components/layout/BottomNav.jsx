import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Paper from '@mui/material/Paper';
import NotesIcon from '@mui/icons-material/Notes';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import SearchIcon from '@mui/icons-material/Search';
import MenuIcon from '@mui/icons-material/Menu';

// Center "Premium" nav item (from the original Android app's paid-features
// promo screen) intentionally removed — this project has no premium tier,
// so a permanently-disabled dead button in the middle of the nav bar was
// just wasted space with no function.
const NAV_ITEMS = [
  { label: '',          icon: <NotesIcon />,             path: '/' },
  { label: '',          icon: <CalendarMonthIcon />,      path: '/calendar' },
  { label: '',          icon: <FolderOutlinedIcon />,     path: '/folders' },
  { label: '',          icon: <SearchIcon />,             path: '/search' },
  { label: '',          icon: <MenuIcon />,               path: '/more' },
];
// Same order as the phone's tab bar (Tab in ui/Common.kt): Notes, Calendar, Folders, Search, More.
// Change one, change the other (see CLAUDE.md, "Both apps").
const CALENDAR_INDEX = 1;

const PATH_TO_INDEX = {
  '/': 0, '/calendar': 1, '/folders': 2, '/search': 3, '/more': 4,
  '/archive': 4, '/trash': 4, '/settings': 4, '/import': 4,
};

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentIndex = PATH_TO_INDEX[location.pathname]
    ?? (location.pathname.startsWith('/folders/') ? 2 : 0);

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <BottomNavigation
        value={currentIndex}
        onChange={(_, newValue) => {
          const item = NAV_ITEMS[newValue];
          if (!item.disabled) navigate(item.path);
        }}
        showLabels={false}
        sx={{ bgcolor: 'background.paper', height: 56 }}
      >
        {NAV_ITEMS.map((item, i) => (
          <BottomNavigationAction
            key={i}
            icon={item.icon}
            disabled={item.disabled}
            sx={{
              color: i === currentIndex ? '#00BCD4' : 'text.secondary',
              minWidth: 0,
              '& .MuiSvgIcon-root': {
                fontSize: i === CALENDAR_INDEX ? '1.4rem' : '1.5rem', // calendar icon slightly smaller
              },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
