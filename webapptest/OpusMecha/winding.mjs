// One stem turn turns the ratchet 13/56 (sliding pinion 13 / crown 35 / ratchet 56); the barrel turns once in 5 h (90 teeth / centre pinion 18).
export const CAPACITY=46*3600,SECONDS_PER_TURN=5*3600*13/56;
export function wind(s,turns){const accepted=Math.max(0,Math.min(turns,(CAPACITY-s.reserve)/SECONDS_PER_TURN));s.reserve+=accepted*SECONDS_PER_TURN;s.turns+=accepted;return accepted;}
export function advance(s,seconds){const used=Math.max(0,Math.min(seconds,s.reserve));s.reserve-=used;s.elapsed+=used;return used;}
