// Wind forecast at kickoff for open-air stadiums (Open-Meteo, free, no key).
// fair_line.py applies -0.267 pts per mph above 7.5 mph, outdoor/open roof only.
const STADIUMS = { // home team -> [lat, lon, roof type]
  ARI:[33.5276,-112.2626,"retractable"], ATL:[33.7554,-84.4008,"retractable"], BAL:[39.2780,-76.6227,"outdoors"], BUF:[42.7738,-78.7870,"outdoors"],
  CAR:[35.2258,-80.8528,"outdoors"], CHI:[41.8623,-87.6167,"outdoors"], CIN:[39.0955,-84.5161,"outdoors"], CLE:[41.5061,-81.6995,"outdoors"],
  DAL:[32.7473,-97.0945,"retractable"], DEN:[39.7439,-105.0201,"outdoors"], DET:[42.3400,-83.0456,"dome"], GB:[44.5013,-88.0622,"outdoors"],
  HOU:[29.6847,-95.4107,"retractable"], IND:[39.7601,-86.1639,"retractable"], JAX:[30.3239,-81.6373,"outdoors"], KC:[39.0489,-94.4839,"outdoors"],
  LA:[33.9535,-118.3392,"dome"], LAC:[33.9535,-118.3392,"dome"], LV:[36.0909,-115.1833,"dome"], MIA:[25.9580,-80.2389,"outdoors"],
  MIN:[44.9737,-93.2575,"dome"], NE:[42.0909,-71.2643,"outdoors"], NO:[29.9511,-90.0812,"dome"], NYG:[40.8135,-74.0745,"outdoors"],
  NYJ:[40.8135,-74.0745,"outdoors"], PHI:[39.9008,-75.1675,"outdoors"], PIT:[40.4468,-80.0158,"outdoors"], SEA:[47.5952,-122.3316,"outdoors"],
  SF:[37.4030,-121.9700,"outdoors"], TB:[27.9759,-82.5033,"outdoors"], TEN:[36.1665,-86.7713,"outdoors"], WAS:[38.9077,-76.8645,"outdoors"],
};
const NEUTRAL = { "Maracana Stadium": [-22.9121, -43.2302, "outdoors"] }; // Brazil game
export function venue(g) {
  const v = NEUTRAL[g.stadium] || STADIUMS[g.home];
  if (!v) return null;
  // Schedule's roof field wins when present; retractable roofs count as closed (usually decided on game day).
  const roof = g.roof || v[2];
  return { lat: v[0], lon: v[1], outdoor: roof === "outdoors" || roof === "open" };
}
export async function windAtKickoff(g) {
  const v = venue(g);
  if (!v || !v.outdoor || !g.kickoff) return { outdoor: !!(v && v.outdoor), wind: null };
  const t = new Date(g.kickoff), day = t.toISOString().slice(0, 10);
  const url = `${process.env.METEO_BASE || "https://api.open-meteo.com"}/v1/forecast?latitude=${v.lat}&longitude=${v.lon}&hourly=wind_speed_10m&wind_speed_unit=mph&timezone=UTC&start_date=${day}&end_date=${day}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    const hour = `${day}T${String(t.getUTCHours()).padStart(2, "0")}:00`;
    const i = (d.hourly && d.hourly.time || []).indexOf(hour);
    return { outdoor: true, wind: i >= 0 ? Math.round(d.hourly.wind_speed_10m[i]) : null };
  } catch { return { outdoor: true, wind: null }; }
}
