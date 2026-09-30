// Artistic rain response; particle allocation stays bounded on mobile.
export function rainResponse(mm) {
  const value = Math.max(0, Math.min(200, Number(mm) || 0));
  const x = Math.max(0, (value - 80) / 120);
  const heavy = x * x * (3 - 2 * x);
  return {
    particles: Math.min(.65, value / 120 * .65) + heavy * .35,
    opacity: Math.min(1, value / 90) + heavy * 1.1,
    width: 1 + heavy * 2.2,
    length: 1 + heavy * 1.8,
    area: 1 - heavy * .28,
    curtain: Math.min(1, value / 90) * (.2 + heavy * .3),
    fog: .000023 + Math.min(value, 150) * .00000105 + heavy * .000015,
    gain: Math.min(value, 150) / 150 * .3 + heavy * .12
  };
}
