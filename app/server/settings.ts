export function readSettings(env: Record<string, string | undefined>) {
  const postcode = env.ORIGIN_POSTCODE?.trim();
  const lat = Number(env.ORIGIN_LATITUDE), lon = Number(env.ORIGIN_LONGITUDE);
  if (!postcode || !env.ORIGIN_LATITUDE || !env.ORIGIN_LONGITUDE || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) throw new Error("Origin is not configured. Run node scripts/configure.mjs from the project root.");
  const radius = Number(env.SEARCH_RADIUS_MILES || 40), maxDrive = Number(env.DEFAULT_MAX_DRIVE_MINUTES || 60);
  if (!Number.isInteger(radius) || radius<1 || radius>100 || !Number.isInteger(maxDrive) || maxDrive<30 || maxDrive>90) throw new Error("Invalid search settings.");
  return { origin: { postcode, lat, lon }, radius, maxDrive };
}
