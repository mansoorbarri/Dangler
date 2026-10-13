import { type Origin, TOWNS } from "../shared/jobs";

// Public routers support CORS. Browser requests avoid datacentre access blocks;
// the server action remains a fallback if the browser cannot reach a provider.
export async function browserCommute(location: string, origin: Origin) {
  let destination: [number, number] | undefined;
  let precision = "Town centre estimate";
  const postcode = location.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0];
  try {
    if (postcode) {
      const response = await fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode), { signal: AbortSignal.timeout(2500) });
      const data = await response.json();
      if (data.result) { destination = [data.result.latitude, data.result.longitude]; precision = "Workplace postcode estimate"; }
    }
    if (!destination) {
      const town = Object.keys(TOWNS).find(t => location.toLowerCase().includes(t));
      if (town && !["remote", "greater manchester", "north west", "north-west", "cheshire", "lancashire", "merseyside"].includes(town)) destination = TOWNS[town];
    }
    if (!destination) return { minutes: null, miles: null, precision: "Workplace location needs checking", error: null };
    for (const host of ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"]) {
      try {
        const response = await fetch(`${host}/route/v1/driving/${origin.lon},${origin.lat};${destination[1]},${destination[0]}?overview=false`, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) continue;
        const route = (await response.json()).routes?.[0];
        if (route) return { minutes: Math.ceil(route.duration / 60), miles: Math.round(route.distance / 1609.344), precision, error: null };
      } catch { /* Try the second public router. */ }
    }
  } catch { /* The server action can retry if browser networking is unavailable. */ }
  return { minutes: null, miles: null, precision, error: "Route unavailable — check Google Maps" };
}
