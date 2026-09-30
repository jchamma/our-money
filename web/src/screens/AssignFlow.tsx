// Move an ongoing item into a project (frames 6c–6d): pick or create a project, save,
// then a toast and the "always assign this merchant?" card.
import { useEffect, useState } from "react";
import { api, type Project, type Tx } from "../api";
import { shortDate } from "../money";
import { t } from "../strings";
import { Modal, Money, Option, Sheet, Toast } from "../ui";

type Stage = { step: "pick" } | { step: "rule"; project: Project; offerRule: boolean };

export function AssignFlow({ tx, onClose, onDone }: { tx: Tx; onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [choice, setChoice] = useState<number | "new" | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  // A project created by a save whose move then failed: a retry reuses it instead of making a twin.
  const [created, setCreated] = useState<Project | null>(null);

  useEffect(() => {
    api.get<{ projects: Project[] }>("/api/projects").then(
      (r) => setProjects(r.projects.filter((p) => p.status === "active")),
      () => setError(t.genericError),
    );
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      let project = projects?.find((p) => p.id === choice);
      if (choice === "new") {
        if (created?.name === newName.trim()) project = created;
        else {
          const { id } = await api.post<{ id: number }>("/api/projects", { name: newName.trim() });
          project = { id, name: newName.trim(), status: "active" };
          setCreated(project);
        }
      }
      if (!project) return;
      const r = await api.post<{ offerRule: boolean }>(`/api/transactions/${encodeURIComponent(tx.id)}/assign`, { projectId: project.id });
      setStage({ step: "rule", project, offerRule: r.offerRule });
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  if (stage.step === "rule") {
    const finish = () => onDone();
    return (
      <>
        <Toast text={t.movedToast(stage.project.name)} onClose={() => (stage.offerRule ? undefined : finish())} />
        {stage.offerRule && (
          <Modal onClose={finish} label={t.alwaysAssignQ(tx.merchant)}>
            <div className="mbody">
              <p className="q" style={{ marginBottom: 4 }}>
                {t.alwaysAssignQ(tx.merchant)}
              </p>
              <div className="track" aria-hidden>
                <div className="pt">
                  <span className="dotc b-tracked" />
                  <span>{tx.merchant}</span>
                </div>
                <div className="ln" />
                <div className="pt">
                  <span className="dotc b-project" />
                  <span className="c-project">{stage.project.name}</span>
                </div>
              </div>
              <div className="helpg">{t.alwaysAssignHelp(tx.merchant)}</div>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await api.post("/api/merchant-rules", { businessName: tx.merchant, projectId: stage.project.id }).catch(() => undefined);
                  finish();
                }}
              >
                {t.yesAlways}
              </button>
              <button type="button" className="ghost" onClick={finish}>
                {t.justThisTime}
              </button>
            </div>
          </Modal>
        )}
      </>
    );
  }

  const ready = choice !== null && (choice !== "new" || newName.trim().length > 0);
  return (
    <Sheet onClose={onClose} label={t.whichProject}>
      <div className="shead from-ongoing">
        <div className="k">
          {tx.category ?? ""} · {tx.income ? t.ongoingIncome : t.ongoingExpense}
        </div>
        <div className="big">
          <Money agorot={tx.amount} />
        </div>
        <div className="s">
          {tx.merchant} · {shortDate(tx.date)}
          {tx.account ? ` · ${tx.account}` : ""}
        </div>
      </div>
      <div className="sbody" role="radiogroup" aria-label={t.whichProject}>
        <p className="q">{t.whichProject}</p>
        {projects?.map((p) => (
          <Option key={p.id} checked={choice === p.id} onSelect={() => setChoice(p.id)}>
            {p.name}
          </Option>
        ))}
        {choice === "new" ? (
          <div className="inp txt" style={{ marginBottom: 8 }}>
            <input autoFocus aria-label={t.newProjectName} placeholder={t.newProjectName} value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
          </div>
        ) : (
          <button type="button" className="opt add" onClick={() => setChoice("new")}>
            {t.newProject}
          </button>
        )}
        <div className="note">{t.moveNote(tx.category ?? "אחר")}</div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" disabled={!ready || busy} onClick={save}>
          {t.save}
        </button>
      </div>
    </Sheet>
  );
}
