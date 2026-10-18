import { assertOperationalDate } from "./intervals";
import type { DateValidity, Eligibility, GroupSnapshot, Indicator, IndicatorPolicy } from "./types";

export function isEffective(validity: DateValidity, date: string): boolean {
  assertOperationalDate(date);
  assertOperationalDate(validity.validFrom);
  if (validity.validTo) assertOperationalDate(validity.validTo);
  if (validity.validTo && validity.validTo < validity.validFrom) throw new Error("INVALID_VALIDITY");
  return date >= validity.validFrom && (!validity.validTo || date <= validity.validTo);
}

export function normalizeGroups(groups: string[] | string): string[] {
  return [...new Set((typeof groups === "string" ? groups.split(",") : groups.flatMap((group) => group.split(",")))
    .map((group) => group.split(/[\\/]/).map((part) => part.trim()).filter(Boolean).at(-1) ?? "")
    .map((group) => group.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR")).filter(Boolean))].sort();
}

/** Defaults start on an explicitly chosen date; never apply a current group retroactively. */
export function initialIndicatorPolicies(validFrom: string, author: string): IndicatorPolicy[] {
  assertOperationalDate(validFrom);
  return ["COZINHA JK", "LIDERANÇA JK"].map((group) => ({
    id: `initial-outside-operation-${group}`, indicator: "outsideOperation", subjectType: "group", subject: group,
    effect: "exclude", validFrom, reason: "Exclusão inicial solicitada para tempo fora da operação", author,
  }));
}

export function resolveEligibility(personId: string, indicator: Indicator, date: string, snapshots: readonly GroupSnapshot[], policies: readonly IndicatorPolicy[]): Eligibility {
  const active = policies.filter((policy) => policy.indicator === indicator && isEffective(policy, date));
  const personal = active.filter((policy) => policy.subjectType === "person" && policy.subject === personId);
  if (personal.length) return resolveMatches(personal);
  const groupPolicies = active.filter((policy) => policy.subjectType === "group");
  if (!groupPolicies.length) return { state: "eligible", policyIds: [], reasons: [] };
  const effective = snapshots.filter((snapshot) => isEffective(snapshot, date) && snapshot.evidence.trim());
  if (!effective.length) return { state: "pending", policyIds: [], reasons: ["Histórico de grupos não confirmado na data operacional"] };
  const versions = new Set(effective.map((snapshot) => normalizeGroups(snapshot.groups).join("\u0000")));
  if (versions.size > 1) return { state: "pending", policyIds: [], reasons: ["Snapshots de grupos conflitantes na vigência"] };
  const groups = normalizeGroups(effective[0].groups);
  const matched = groupPolicies.filter((policy) => groups.includes(normalizeGroups([policy.subject])[0]));
  if (!matched.length) return { state: "eligible", policyIds: [], reasons: [] };
  // A group exclusion wins over another group inclusion; personal decisions have already won above.
  const exclusions = matched.filter((policy) => policy.effect === "exclude");
  return resolveMatches(exclusions.length ? exclusions : matched);
}

function resolveMatches(matches: IndicatorPolicy[]): Eligibility {
  const effects = new Set(matches.map((policy) => policy.effect));
  return {
    state: effects.size > 1 ? "pending" : matches[0].effect === "exclude" ? "excluded" : "eligible",
    policyIds: matches.map((policy) => policy.id).sort(),
    reasons: effects.size > 1 ? ["Exceções individuais conflitantes na vigência"] : [...new Set(matches.map((policy) => policy.reason))],
  };
}
