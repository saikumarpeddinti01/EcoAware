// Shared front-end config — loaded by every page (before its own <script> block).
// One source of truth: change the API's location or a category mapping here, once,
// instead of hunting through every HTML page for a copy of the same constant.

const API_BASE = 'https://ecoaware-ko5a.onrender.com/api';

// Backend categories (Waste/Water/Energy/Safety/Other) <-> the shorter names used
// in a couple of older UI spots (waste/water/energy/general).
const CATEGORY_TO_API = { waste: 'Waste', water: 'Water', energy: 'Energy', general: 'Other' };
const API_TO_CATEGORY = { Waste: 'waste', Water: 'water', Energy: 'energy', Safety: 'general', Other: 'general' };
