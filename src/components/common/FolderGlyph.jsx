import React from 'react';
import FolderIcon from '@mui/icons-material/Folder';
import StarIcon from '@mui/icons-material/Star';
import FavoriteIcon from '@mui/icons-material/Favorite';
import HomeIcon from '@mui/icons-material/Home';
import WorkIcon from '@mui/icons-material/Work';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import FlightIcon from '@mui/icons-material/Flight';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import { folderIconIndex } from '../../utils/folders';

// Same order as the Android app's nine folder icons (plain, star, heart, home, work, cart, book, flight, music).
const ICONS = [FolderIcon, StarIcon, FavoriteIcon, HomeIcon, WorkIcon, ShoppingCartIcon, MenuBookIcon, FlightIcon, MusicNoteIcon];

export default function FolderGlyph({ index = 0, ...props }) {
  const Icon = ICONS[folderIconIndex(index)];
  return <Icon {...props} />;
}
