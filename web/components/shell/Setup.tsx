// Onboarding at /setup (phase1-plan.md, item U3; mock u3 option B). Step 1 asks only for the role,
// and offers the department profiles preloaded for the testing sessions, which open their dashboard
// at once. Step 2 (/setup?role=...) starts from the role's suggested picks to trim, beside a preview
// of the week's developments for them; Create dashboard makes the role's profile and opens it.
// The first visit, before any role is picked, lands here; "Add a role" in the profile menu too.
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { Schema } from "@/lib/api/client";
import {
  errorMessage,
  useActivateProfile,
  useCreateProfile,
  useDashboard,
  useDevelopments,
  useProfile,
  useProfiles,
  useSubjects,
  useSuggestions,
  type Role,
} from "@/lib/api/queries";
import { ROLES, roleName } from "@/lib/roles";
import { EntityPicker, pickCount, pickName } from "@/components/dashboard/EntityPicker";
import { FeedHeader, FeedRow } from "@/components/developments/FeedRow";
import { ChevronIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

export function Setup({ role }: { role?: Role }) {
  // Set when the user already has a role and came here from "Add a role".
  const adding = useProfile().data?.role != null;
  return (
    <div className="setup">
      <header className="setup-bar">
        <Link to="/" className="setup-brand">
          IntelMonitor
        </Link>
        <span className="meta">Step {role ? 2 : 1} of 2</span>
        {adding && (
          <Link to="/" className="btn btn-sm">
            Cancel
          </Link>
        )}
      </header>
      {role ? <PickStep key={role} role={role} adding={adding} /> : <RoleStep />}
    </div>
  );
}

function RoleStep() {
  const profiles = useProfiles();
  // The user's own profiles have their role as id; the others are the department preloads.
  const presets = profiles.data?.filter((p) => p.id !== p.role) ?? [];
  return (
    <main className="setup-step">
      <div className="pagehead setup-head">
        <div>
          <h1>What is your role?</h1>
          <p>Your first dashboard is set up from it. You can change it later from your profile.</p>
        </div>
      </div>
      <ul className="setup-roles">
        {ROLES.map((r) => (
          <li key={r.role}>
            <Link to="/setup" search={{ role: r.role }} className="setup-role">
              <span>
                <b>{r.name}</b>
                <span className="meta">{r.suggests}</span>
              </span>
              <ChevronIcon />
            </Link>
          </li>
        ))}
      </ul>
      {presets.length > 0 && (
        <section aria-labelledby="setup-presets">
          <h2 id="setup-presets" className="setup-h2">
            Preloaded for your department
          </h2>
          <ul className="setup-roles">
            {presets.map((p) => (
              <li key={p.id}>
                <PresetRow profile={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** A department profile: its role and what its dashboard covers. Choosing it opens that dashboard. */
function PresetRow({ profile }: { profile: Schema<"Profile"> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const subjects = useSubjects();
  const dashboard = useDashboard(profile.default_dashboard_id ?? "", profile.default_dashboard_id !== null);
  const activate = useActivateProfile();
  const covers = dashboard.data ? `${pickCount(dashboard.data.subject_ids, subjects.data)}. ` : "";
  return (
    <button
      type="button"
      className="setup-role"
      disabled={activate.isPending}
      onClick={() =>
        profile.id &&
        activate.mutate(profile.id, {
          onSuccess: (p) =>
            p.default_dashboard_id
              ? navigate({ to: "/dashboards/$id", params: { id: p.default_dashboard_id } })
              : navigate({ to: "/" }),
          onError: (e) => toast({ message: errorMessage(e, "Could not open this profile") }),
        })
      }
    >
      <span>
        <b>{profile.name}</b>
        <span className="meta">
          {profile.role && `${roleName(profile.role)}. `}
          {covers}Opens its dashboard directly.
        </span>
      </span>
      <ChevronIcon />
    </button>
  );
}

function PickStep({ role, adding }: { role: Role; adding: boolean }) {
  const suggestions = useSuggestions(role);
  if (suggestions.isError) return <p className="page-message">Could not load the suggestions. Reload to try again.</p>;
  if (!suggestions.data) return null;
  return <PickForm role={role} suggestions={suggestions.data} adding={adding} />;
}

const forWhom = (role: Role) =>
  role === "development_staff" ? "development staff" : `a ${roleName(role).toLowerCase()}`;

function PickForm({
  role,
  suggestions,
  adding,
}: {
  role: Role;
  suggestions: Schema<"Suggestions">;
  adding: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const subjects = useSubjects();
  const create = useCreateProfile();
  const [picked, setPicked] = useState(() => new Set(suggestions.picks));
  const [ownPicks, setOwnPicks] = useState(false);
  const [typedName, setTypedName] = useState<string | null>(null);

  // The role's dashboard name, or once the picks change, a group's name when they are exactly that
  // group. Picking from scratch drops the role's name.
  const untouched = picked.size === suggestions.picks.length && suggestions.picks.every((id) => picked.has(id));
  const fallback = ownPicks ? "My dashboard" : suggestions.name;
  const shownName = typedName ?? (untouched ? suggestions.name : pickName(suggestions.groups, picked, fallback));
  const name = shownName.trim() || "My dashboard";

  const submit = () => {
    if (picked.size === 0 || create.isPending) return;
    create.mutate(
      { role, dashboard_name: name, subject_ids: [...picked] },
      {
        onSuccess: (p) => {
          if (p.default_dashboard_id) void navigate({ to: "/dashboards/$id", params: { id: p.default_dashboard_id } });
        },
        onError: (e) => toast({ message: errorMessage(e, "Could not create the dashboard") }),
      },
    );
  };

  return (
    <form
      className="setup-step setup-picks"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="pagehead setup-head">
        <div>
          <h1>{adding ? "Your new dashboard" : "Your first dashboard"}</h1>
          <p>
            {ownPicks
              ? "Pick the entities and topics to follow."
              : role === "other"
                ? "The entities MAS supervises that this app tracks. Untick anything you do not need."
                : `Picked for ${forWhom(role)}. Untick anything you do not need.`}
          </p>
        </div>
      </div>
      <div className="setup-cols">
        <div>
          <EntityPicker
            key={ownPicks ? "own" : "suggested"}
            suggestions={suggestions}
            picked={picked}
            onChange={setPicked}
            openMore={ownPicks}
          />
          {role === "other" && !ownPicks && (
            <button
              type="button"
              className="link setup-own"
              onClick={() => {
                setPicked(new Set());
                setOwnPicks(true);
              }}
            >
              Pick my own instead
            </button>
          )}
        </div>
        <Preview picked={picked} />
      </div>
      <div className="setup-foot">
        <Link to="/setup" className="btn">
          Back
        </Link>
        <label className="nd-name">
          Dashboard name
          <span className="field">
            <input value={shownName} maxLength={80} onChange={(e) => setTypedName(e.target.value)} />
          </span>
        </label>
        <span className="grow" />
        <span className="nd-num" role="status">
          {pickCount(picked, subjects.data)}
        </span>
        <span className="setup-create">
          <button type="submit" className="btn btn-primary" disabled={picked.size === 0 || create.isPending}>
            Create dashboard
          </button>
          <span className="meta">Opens your dashboard with its feed.</span>
        </span>
      </div>
    </form>
  );
}

/** The week's developments for the picks, highest priority first; refetches 300 ms after a change. */
function Preview({ picked }: { picked: Set<string> }) {
  const ids = [...picked].sort();
  const key = ids.join(",");
  const [settled, setSettled] = useState(ids);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(key ? key.split(",") : []), 300);
    return () => window.clearTimeout(t);
  }, [key]);
  const list = useDevelopments({ subject_id: settled, days: 7, limit: 3, dismissed: false }, settled.length > 0);
  const data = settled.length > 0 ? list.data : undefined;
  const high = data?.facets.priority.find((v) => v.value === "High")?.count ?? 0;

  return (
    <aside className="setup-preview" aria-labelledby="setup-preview-title">
      <div className="setup-preview-head">
        <h2 id="setup-preview-title">What this dashboard shows</h2>
        <span className="meta">This week</span>
      </div>
      {settled.length === 0 ? (
        <p className="meta">Pick at least one entity or topic.</p>
      ) : list.isError ? (
        <p className="meta">Could not load the preview.</p>
      ) : data && data.matching === 0 ? (
        <p className="meta">Nothing this week for these picks.</p>
      ) : (
        data && (
          <>
            <p className="setup-preview-count">
              {data.matching} {data.matching === 1 ? "development" : "developments"},{" "}
              {high ? `${high} High` : "none High"}
            </p>
            <FeedHeader />
            <ol className="frows">
              {data.developments.map((d) => (
                <FeedRow key={d.id} development={d} scope={null} />
              ))}
            </ol>
          </>
        )
      )}
    </aside>
  );
}
