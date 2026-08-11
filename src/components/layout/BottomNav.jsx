import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Paper from '@mui/material/Paper';
import NotesIcon from '@mui/icons-material/Notes';
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
  { label: '',          icon: <SearchIcon />,             path: '/search' },
  { label: '',          icon: <MenuIcon />,               path: '/more' },
];

const PATH_TO_INDEX = {
  '/': 0, '/calendar': 1, '/search': 2, '/more': 3,
  '/archive': 3, '/trash': 3, '/settings': 3, '/import': 3,
};

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentIndex = PATH_TO_INDEX[location.pathname] ?? 0;

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        borderTop: '1px solid rgba(0,0,0,0.1)',
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
                fontSize: i === 1 ? '1.4rem' : '1.5rem', // calendar icon slightly smaller
              },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
