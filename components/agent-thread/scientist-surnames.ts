const SCIENTIST_SURNAMES = [
  "Curie",
  "Einstein",
  "Noether",
  "Turing",
  "Hopper",
  "Feynman",
  "Lovelace",
  "Bohr",
  "Faraday",
  "Franklin",
  "Maxwell",
  "Meitner",
  "Newton",
  "Sagan",
  "Tesla",
  "Ramanujan",
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function scientistSurnameFor(seed: string, index: number) {
  return SCIENTIST_SURNAMES[(stableHash(seed) + index * 7) % SCIENTIST_SURNAMES.length];
}
