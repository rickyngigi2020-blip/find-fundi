// Fill this in with your restricted (HTTP-referrer-locked) Google Maps API key.
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';

let _mapsLoadPromise = null;
function loadGoogleMaps() {
  if (window.google && window.google.maps) return Promise.resolve();
  if (_mapsLoadPromise) return _mapsLoadPromise;

  _mapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Maps.'));
    document.head.appendChild(script);
  });
  return _mapsLoadPromise;
}

// Renders a simple pins-only map into containerId. `points` is an array of
// { key, position: {lat, lng}, label, title }. Returns a handle with
// updateMarker(key, position) so callers can move a pin live.
async function renderPinMap(containerId, points) {
  await loadGoogleMaps();

  const center = points[0] ? points[0].position : { lat: -1.2921, lng: 36.8219 }; // Nairobi fallback
  const map = new google.maps.Map(document.getElementById(containerId), {
    center,
    zoom: points.length > 1 ? 12 : 14,
    disableDefaultUI: true,
    zoomControl: true,
  });

  const bounds = new google.maps.LatLngBounds();
  const markers = {};
  points.forEach((p) => {
    markers[p.key] = new google.maps.Marker({ position: p.position, map, label: p.label, title: p.title });
    bounds.extend(p.position);
  });
  if (points.length > 1) map.fitBounds(bounds, 60);

  return {
    // Moves an existing marker, or creates it (with the given label/title)
    // if this is the first time this key has appeared.
    setMarker(key, position, label, title) {
      if (markers[key]) {
        markers[key].setPosition(position);
      } else {
        markers[key] = new google.maps.Marker({ position, map, label, title });
      }
      const b = new google.maps.LatLngBounds();
      Object.values(markers).forEach((m) => b.extend(m.getPosition()));
      if (Object.keys(markers).length > 1) map.fitBounds(b, 60);
    },
  };
}
