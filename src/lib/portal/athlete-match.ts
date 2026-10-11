/** Callers must supply only athletes already authorized for the current household. */
export type MatchableAthlete = { id: string; name: string };

export type AthleteSuggestion = {
  kind: "unique" | "ambiguous" | "none";
  candidates: Array<MatchableAthlete & { match: "full_name" | "partial_name" }>;
};

const noMatch = (): AthleteSuggestion => ({ kind: "none", candidates: [] });
const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function tokens(value: string): string[] {
  return (
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function nextPosition(positions: readonly number[], after: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle]! <= after) low = middle + 1;
    else high = middle;
  }
  return positions[low] ?? -1;
}

function isSubsequence(needle: readonly string[], haystack: readonly string[]) {
  let matched = 0;
  for (const token of haystack) {
    if (token === needle[matched]) matched++;
    if (matched === needle.length) return true;
  }
  return false;
}

type Name = { athlete: MatchableAthlete; tokens: string[] };
type Occurrence = {
  name: Name;
  start: number;
  positions: number[];
  full: boolean;
};

/**
 * Unverified suggestions from transfer detail only; never selects a month or amount.
 * Accent, case and punctuation normalization does not add aliases or fuzzy matches.
 * Oversized or invalid inputs abstain rather than silently dropping a possible match.
 */
export function suggestAthletes(
  description: string | null,
  athletes: readonly MatchableAthlete[],
): AthleteSuggestion {
  if (
    typeof description !== "string" ||
    description.length > 500 ||
    forbiddenControl.test(description) ||
    !Array.isArray(athletes) ||
    athletes.length > 300
  )
    return noMatch();

  const names: Name[] = [];
  const seen = new Map<string, string>();
  for (const athlete of athletes) {
    if (
      !athlete ||
      typeof athlete.id !== "string" ||
      !athlete.id.trim() ||
      athlete.id.length > 80 ||
      typeof athlete.name !== "string" ||
      !athlete.name.trim() ||
      athlete.name.length > 160 ||
      forbiddenControl.test(athlete.id) ||
      forbiddenControl.test(athlete.name)
    )
      return noMatch();
    const nameTokens = tokens(athlete.name);
    // Numeric bank data must never stand in for any part of a person's name.
    if (
      !nameTokens.length ||
      nameTokens.some((token) => !/^\p{L}+$/u.test(token))
    )
      return noMatch();
    const existing = seen.get(athlete.id);
    const normalized = nameTokens.join(" ");
    if (existing !== undefined) {
      if (existing !== normalized) return noMatch();
      continue;
    }
    seen.set(athlete.id, normalized);
    names.push({
      athlete: { id: athlete.id, name: athlete.name },
      tokens: nameTokens,
    });
  }

  const detail = tokens(description);
  if (!detail.length) return noMatch();
  const positions = new Map<string, number[]>();
  detail.forEach((token, index) => {
    const indexes = positions.get(token) ?? [];
    indexes.push(index);
    positions.set(token, indexes);
  });

  const occurrences: Occurrence[] = [];
  for (const name of names) {
    for (const start of positions.get(name.tokens[0]!) ?? []) {
      const full = name.tokens.every(
        (token, offset) => token === detail[start + offset],
      );
      const matched = [start];
      let previous = start;
      for (const token of name.tokens.slice(1)) {
        const next = nextPosition(positions.get(token) ?? [], previous);
        if (next !== -1) {
          matched.push(next);
          previous = next;
        }
      }
      // Short given names need a second exact name token, even for a one-token name.
      if (name.tokens[0]!.length < 3 && matched.length < 2) continue;
      occurrences.push({ name, start, positions: matched, full });
    }
  }

  const fullNames = occurrences.filter((occurrence) => occurrence.full);
  const candidates: AthleteSuggestion["candidates"] = [];
  for (const name of names) {
    const plausible = occurrences.filter((occurrence) => {
      if (occurrence.name !== name) return false;
      if (occurrence.full) return true;
      // A full name resolves a shared first-name occurrence only when the other
      // child's remaining legal name has no evidence outside that full-name span.
      return !fullNames.some(
        (full) =>
          full.start === occurrence.start &&
          occurrence.positions.every(
            (position) => position < full.start + full.name.tokens.length,
          ) &&
          !isSubsequence(full.name.tokens, name.tokens),
      );
    });
    if (!plausible.length) continue;
    candidates.push({
      ...name.athlete,
      match: plausible.some((occurrence) => occurrence.full)
        ? "full_name"
        : "partial_name",
    });
  }
  return {
    kind:
      candidates.length === 1
        ? "unique"
        : candidates.length > 1
          ? "ambiguous"
          : "none",
    candidates,
  };
}
