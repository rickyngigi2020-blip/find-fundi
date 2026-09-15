// Single source for service categories on the frontend. Keys must match the
// fundi_profiles_category_check constraint and fundiController CATEGORIES.
const FUNDI_CATEGORIES = [
  {
    key: 'phone_electronics',
    label: 'Phones & Electronics',
    group: 'repairs',
    examples: ['Cracked screens', 'Batteries', 'Charging ports', 'TVs', 'Radios', 'Speakers', 'Gaming consoles'],
    icon: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  },
  {
    key: 'computer_laptop',
    label: 'Computers & Laptops',
    group: 'repairs',
    examples: ['Laptops', 'Desktops', 'Printers', 'Monitors', 'Keyboards', 'Data recovery'],
    icon: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>',
  },
  {
    key: 'appliance',
    label: 'Home Appliances',
    group: 'repairs',
    examples: ['Fridges', 'Washing machines', 'Cookers', 'Microwaves', 'Water dispensers', 'Irons', 'Blenders'],
    icon: '<rect x="6" y="2.5" width="12" height="19" rx="1.5"/><path d="M6 10h12"/><path d="M9 5.5v2"/><path d="M9 13.5v2"/>',
  },
  {
    key: 'mechanical',
    label: 'Vehicles',
    group: 'repairs',
    examples: ['Engines', 'Brakes', 'Car batteries', 'Tyres', 'Clutches', 'Motorbikes', 'Car electrics'],
    icon: '<path d="M4 15l1.5-4.6A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.4L20 15"/><rect x="3" y="15" width="18" height="3.5" rx="1"/><circle cx="7.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  },
  {
    key: 'general_maintenance',
    label: 'General Maintenance',
    group: 'services',
    examples: ['Plumbing', 'Electrical wiring', 'Sockets', 'Leaking taps', 'Painting', 'Carpentry', 'Tiling', 'Roof leaks'],
    icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  },
  {
    key: 'installation',
    label: 'Installation',
    group: 'services',
    examples: ['TV mounting', 'CCTV', 'Solar panels', 'Water heaters', 'Satellite dishes', 'Curtain rails', 'Shelves'],
    icon: '<path d="m15 12-8.4 8.4a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.9-1.9A2 2 0 0 1 19 8.2V7l-2.3-1.1a6 6 0 0 0-2.7-.7H13l.9.8A6 6 0 0 1 16 10.5V12l2 2h1.2a2 2 0 0 1 1.4.6L22 16"/>',
  },
];

const CATEGORY_GROUPS = [
  { key: 'repairs', label: 'Repairs' },
  { key: 'services', label: 'Maintenance & services' },
];

const CATEGORY_LABELS = Object.fromEntries(FUNDI_CATEGORIES.map((c) => [c.key, c.label]));
// Jobs created before the category restructure may still carry this key.
CATEGORY_LABELS.electrical = 'General Maintenance';

function categoryIconSvg(key, className) {
  const cat = FUNDI_CATEGORIES.find((c) => c.key === key);
  if (!cat) return '';
  return `<svg class="${className || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cat.icon}</svg>`;
}
