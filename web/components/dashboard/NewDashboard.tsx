// The New dashboard and Edit dashboard popup: about 80% of the screen, the subject picker
// (EntityPicker.tsx) with every group open, then the name and Create dashboard or Save. Esc or a
// backdrop click closes it. A new dashboard belongs to the active profile and opens once created.
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  errorMessage,
  useCreateDashboard,
  useSaveDashboard,
  useSubjects,
  useSuggestions,
  type Dashboard,
} from "@/lib/api/queries";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

import { EntityPicker, pickCount, pickName } from "./EntityPicker";

const FALLBACK_NAME = "My dashboard";

export function NewDashboard({
  open,
  onClose,
  dashboard,
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this dashboard instead of making a new one. */
  dashboard?: Dashboard;
}) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="new-dashboard-title" className="sheet">
      <DashboardForm onClose={onClose} dashboard={dashboard} />
    </Modal>
  );
}

function DashboardForm({ onClose, dashboard }: { onClose: () => void; dashboard?: Dashboard }) {
  const navigate = useNavigate();
  const toast = useToast();
  const subjects = useSubjects();
  const suggestions = useSuggestions(null);
  const create = useCreateDashboard();
  const save = useSaveDashboard(() => toast({ message: "Could not save the dashboard" }));
  const [picked, setPicked] = useState(() => new Set(dashboard?.subject_ids ?? []));
  const [typedName, setTypedName] = useState<string | null>(dashboard?.name ?? null);

  const groups = suggestions.data?.groups ?? [];
  const shownName = typedName ?? pickName(groups, picked, FALLBACK_NAME);
  const name = shownName.trim() || FALLBACK_NAME;
  const canSubmit = picked.size > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const subject_ids = [...picked];
    if (dashboard) {
      save({ ...dashboard, name, subject_ids });
      onClose();
      return;
    }
    create.mutate(
      { name, subject_ids, widgets: [] },
      {
        onSuccess: (created) => {
          onClose();
          void navigate({ to: "/dashboards/$id", params: { id: created.id } });
          toast({ message: `Created ${created.name}` });
        },
        onError: (e) => toast({ message: errorMessage(e, "Could not create the dashboard") }),
      },
    );
  };

  return (
    <>
      <div className="sheet-head">
        <h2 id="new-dashboard-title">{dashboard ? "Edit dashboard" : "New dashboard"}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="nd-body nd-pick">
        {suggestions.data && <EntityPicker suggestions={suggestions.data} picked={picked} onChange={setPicked} />}
        {suggestions.isError && <p className="cap">Could not load the list. Close and try again.</p>}
      </div>
      <form
        className="nd-foot"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
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
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {dashboard ? "Save" : "Create dashboard"}
        </button>
      </form>
    </>
  );
}
