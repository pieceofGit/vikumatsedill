/**
 * Club-name matching, in one place.
 *
 * Four feeds name the same clubs differently — openfootball says "Tottenham",
 * ESPN says "Nottm Forest", FPL says "Spurs" — so every comparison in this
 * project goes through here. Keeping the alias list in one file matters: it has
 * already caused a bug once by drifting between copies.
 */
export const norm = (s) => (s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|afc|cf|sc)\b/g, ' ')
  .replace(/\s+/g, ' ').trim()

export const CLUB_ALIASES = [
  ['man utd', 'man united', 'manchester united'],
  ['man city', 'manchester city'],
  ['tottenham', 'spurs', 'tottenham hotspur'],
  ['nott m forest', 'nottingham forest', 'nottm forest', 'forest'],
  ['brighton', 'brighton hove albion', 'brighton and hove albion'],
  ['wolves', 'wolverhampton wanderers'],
  ['newcastle', 'newcastle united'],
  ['leeds', 'leeds united'],
  ['hull city', 'hull'],
  ['coventry', 'coventry city'],
  ['ipswich', 'ipswich town'],
  ['west ham', 'west ham united'],
  ['bournemouth', 'afc bournemouth'],
  ['sunderland', 'sunderland afc'],
  ['crystal palace', 'palace'],
  ['inter milan', 'internazionale', 'inter'],
  ['atletico', 'atletico madrid', 'atl madrid'],
  ['ac milan', 'milan'],
  ['dortmund', 'borussia dortmund'],
  ['bayern', 'bayern munchen', 'bayern munich'],
  ['psg', 'paris saint germain', 'paris sg'],
  ['porto', 'fc porto'],
  ['as roma', 'roma'],
]

/** Do these two names refer to the same club? */
export const sameClub = (a, b) => {
  const [x, y] = [norm(a), norm(b)]
  if (!x || !y) return false
  if (x === y) return true
  return CLUB_ALIASES.some((g) => g.includes(x) && g.includes(y))
}

/** Is this club one of `names` (a normalised alias group)? */
export const isOneOf = (team, names) => names.includes(norm(team))
