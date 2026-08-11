// ColorNote color palette — verified against the actual ColorNote color picker.
// The picker is a 2-column grid (left→right, top→bottom), indexed 0–9:
//
//  [0: None/White  ] [1: Red    ]   ← Dreams, Love
//  [2: Orange      ] [3: Yellow ]   ← Dates Related / To Do
//  [4: Green       ] [5: Blue   ]   ← Thoughts / Life
//  [6: Purple      ] [7: Dark   ]   ← Review / Stories
//  [8: Light Gray  ] [9: Light  ]   ← Editing Tips / To Download List

export const NOTE_COLORS = {
  0: { bg: '#FFFFFF', text: '#212121', border: '#BDBDBD', name: 'None' },
  1: { bg: '#EF9A9A', text: '#212121', border: '#C62828', name: 'Red' },       // Dreams, Love
  2: { bg: '#FFCC80', text: '#212121', border: '#E65100', name: 'Orange' },    // Dates Related
  3: { bg: '#FFEE58', text: '#212121', border: '#F9A825', name: 'Yellow' },    // To Do
  4: { bg: '#C5E1A5', text: '#212121', border: '#558B2F', name: 'Green' },     // Thoughts
  5: { bg: '#90CAF9', text: '#212121', border: '#1565C0', name: 'Blue' },      // Life
  6: { bg: '#CE93D8', text: '#212121', border: '#6A1B9A', name: 'Purple' },    // Review
  7: { bg: '#424242', text: '#FFFFFF', border: '#212121', name: 'Dark' },      // Stories
  8: { bg: '#EEEEEE', text: '#424242', border: '#9E9E9E', name: 'Gray' },      // Editing Tips
  9: { bg: '#F5F5F5', text: '#757575', border: '#BDBDBD', name: 'Light' },     // To Download List
};

export const getColor = (index) => NOTE_COLORS[index] ?? NOTE_COLORS[0];

// Calendar dot colors — use the border shade so they're visible on white
export const calendarDotColor = (colorIndex) => {
  if (colorIndex === 0) return '#9E9E9E';
  return NOTE_COLORS[colorIndex]?.border ?? '#9E9E9E';
};
