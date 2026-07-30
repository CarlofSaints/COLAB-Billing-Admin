"use client";

import { useMemo } from "react";
import { Users2 } from "lucide-react";
import { Input, Field, Select } from "@/components/ui/field";
import { TagChip } from "@/components/tag-chip";
import { cn } from "@/lib/utils";
import { matchesRule, describeRule, type GroupRule, type RulePerson } from "@/lib/group-rules";

export type RuleStaff = RulePerson & { id: number };
export type RuleTag = { id: number; name: string; color: string | null };
export type RuleCompany = { id: number; name: string };

/**
 * The filter that defines a live group, plus a preview of exactly who it
 * currently matches.
 *
 * The preview runs `matchesRule` — the same function the server resolves
 * membership with — so what is listed here is what would be emailed. Showing a
 * count from a different code path would be worse than showing none.
 *
 * Emits hidden inputs, so the parent just wraps it in a form.
 */
export function GroupRuleBuilder({
  rule,
  onChange,
  staff,
  tags,
  companies,
  genders,
}: {
  rule: GroupRule;
  onChange: (next: GroupRule) => void;
  staff: RuleStaff[];
  tags: RuleTag[];
  companies: RuleCompany[];
  genders: string[];
}) {
  const matched = useMemo(() => staff.filter((s) => matchesRule(s, rule)), [staff, rule]);
  const reachable = useMemo(
    () => matched.filter((s) => (s.email ?? "").includes("@")),
    [matched],
  );

  const set = (patch: Partial<GroupRule>) => onChange({ ...rule, ...patch });

  const toggleTag = (id: number) =>
    set({
      untaggedOnly: false,
      tagIds: rule.tagIds.includes(id)
        ? rule.tagIds.filter((t) => t !== id)
        : [...rule.tagIds, id],
    });

  const lookup = {
    companyName: (id: number) => companies.find((c) => c.id === id)?.name,
    tagName: (id: number) => tags.find((t) => t.id === id)?.name,
  };

  return (
    <div className="space-y-4">
      {/* Hidden inputs — the rule travels with the form, not in component state. */}
      <input type="hidden" name="membership" value="rule" />
      <input type="hidden" name="ruleCompanyId" value={rule.companyId ?? ""} />
      <input type="hidden" name="ruleGender" value={rule.gender ?? ""} />
      <input type="hidden" name="ruleSearch" value={rule.search ?? ""} />
      <input
        type="hidden"
        name="ruleBilling"
        value={rule.includeInBilling == null ? "" : rule.includeInBilling ? "yes" : "no"}
      />
      {rule.untaggedOnly && <input type="hidden" name="ruleUntagged" value="on" />}
      {rule.tagIds.map((id) => (
        <input key={id} type="hidden" name="ruleTagId" value={id} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sub-company">
          <Select
            value={rule.companyId ?? ""}
            onChange={(e) => set({ companyId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Everyone</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select
            value={rule.gender ?? ""}
            onChange={(e) => set({ gender: e.target.value || null })}
          >
            <option value="">Any</option>
            {genders.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <TagChip
              key={t.id}
              name={t.name}
              color={t.color}
              selected={rule.tagIds.includes(t.id)}
              onClick={() => toggleTag(t.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => set({ untaggedOnly: !rule.untaggedOnly, tagIds: [] })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              rule.untaggedOnly
                ? "border-slate-700 bg-slate-700 text-white"
                : "border-line bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            No tags
          </button>
        </div>
        {rule.tagIds.length > 1 && (
          <p className="mt-1.5 text-xs text-muted">
            Someone must carry <strong>all</strong> the chosen tags, not just one of them.
          </p>
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Billed for">
          <Select
            value={rule.includeInBilling == null ? "" : rule.includeInBilling ? "yes" : "no"}
            onChange={(e) =>
              set({
                includeInBilling:
                  e.target.value === "yes" ? true : e.target.value === "no" ? false : null,
              })
            }
          >
            <option value="">Either</option>
            <option value="yes">Included in billing</option>
            <option value="no">Not billed for</option>
          </Select>
        </Field>
        <Field label="Text match (optional)">
          <Input
            value={rule.search ?? ""}
            onChange={(e) => set({ search: e.target.value || null })}
            placeholder="name, email, position…"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-line bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-800">{describeRule(rule, lookup)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <Users2 className="h-4 w-4" />
          <span>
            <strong>{reachable.length}</strong> would be emailed right now
            {matched.length !== reachable.length && (
              <> · {matched.length - reachable.length} matched but have no email address</>
            )}
          </span>
        </p>
        {matched.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto text-xs text-slate-600">
            {matched.map((s) => (
              <div key={s.id} className="flex justify-between gap-3 py-0.5">
                <span>{s.name}</span>
                <span className={cn("text-muted", !s.email && "text-amber-700")}>
                  {s.email || "no email address"}
                </span>
              </div>
            ))}
          </div>
        )}
        {matched.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            Nobody matches this filter yet. The group will stay empty until someone does — which is
            fine for a rule like “everyone tagged Parking”, but check it isn’t a mistake.
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          This is a live rule: it is worked out again every time the group is used, so anyone who
          starts matching later is included automatically.
        </p>
      </div>
    </div>
  );
}
