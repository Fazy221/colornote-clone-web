import { createTheme } from '@mui/material/styles';

// ColorNote's primary color is the teal/cyan used for FAB, active nav, accents
export const buildTheme = (darkMode = false) => createTheme({
  palette: {
    mode: darkMode ? 'dark' : 'light',
    primary: {
      main: '#00BCD4',       // Cyan 500 — ColorNote's brand color
      light: '#4DD0E1',
      dark: '#0097A7',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#00BCD4',
    },
    background: {
      default: darkMode ? '#1A1A1A' : '#f5f5f5',
      paper:   darkMode ? '#2C2C2C' : '#ffffff',
    },
    text: {
      primary: darkMode ? '#FFFFFF' : '#212121',
      secondary: darkMode ? '#BDBDBD' : '#757575',
    },
  },

  typography: {
    fontFamily: "'Roboto', sans-serif",
    h6: { fontWeight: 500, fontSize: '1.1rem' },
    body1: { fontSize: '0.95rem' },
    body2: { fontSize: '0.85rem', color: darkMode ? '#BDBDBD' : '#757575' },
    caption: { fontSize: '0.75rem' },
  },

  shape: { borderRadius: 4 },

  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        },
      },
      defaultProps: { elevation: 0 },
    },

    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          height: 56,
          borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
        },
      },
    },

    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          minWidth: 'auto',
          padding: '6px 0',
          '&.Mui-selected': {
            color: '#00BCD4',
          },
        },
        label: {
          fontSize: '0.65rem',
          '&.Mui-selected': { fontSize: '0.65rem' },
        },
      },
    },

    MuiFab: {
      styleOverrides: {
        root: {
          backgroundColor: '#00BCD4',
          color: '#ffffff',
          '&:hover': { backgroundColor: '#0097A7' },
          boxShadow: '0 4px 8px rgba(0,188,212,0.35)',
          width: 56,
          height: 56,
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 8 },
      },
    },

    MuiListItem: {
      styleOverrides: {
        root: { paddingTop: 6, paddingBottom: 6 },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: { borderColor: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' },
      },
    },
  },
});
