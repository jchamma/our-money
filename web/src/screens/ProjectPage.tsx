// A project's month (frames 6e–6h): hero, category cards (⋮ edits the plan), income,
// reassigning an item, and adding a category.
import { useEffect, useState } from "react";
import { api, useLoad, type Project, type ProjectMonth, type Tx } from "../api";
import { parseShekels, plainWhole, shortDate } from "../money";
import { currentMonth, navigate } from "../router";
import { t } from "../strings";
import { AmountInput, LoadFailed, Modal, Money, MonthSwitcher, Net, Option, SectionCard, Sheet, spendStatus, Toast, TxRows } from "../ui";

type Category = ProjectMonth["categories"][number];

export function ProjectPage({ id, month }: { id: number; month: string }) {
  const { data, failed, reload } = useLoad<ProjectMonth>(`/api/projects/${id}/months/${month}`);
  const [reassigning, setReassigning] = useState<Tx | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState("");
  // A sheet or modal belongs to the month it was opened in.
  useEffect(() => {
    setReassigning(null);
    setEditing(null);
    setAdding(false);
  }, [id, month]);

  const back = () => navigate(month === currentMonth() ? "/" : `/?month=${month}`);
  const reassign = { label: t.reassign, onPick: setReassigning };
  const card = (c: Category) => (
    <SectionCard
      key={c.id}
      title={c.name}
      tone={c.kind === "income" ? "income" : "project"}
      income={c.kind === "income"}
      actual={c.actual}
      expected={c.plan}
      status={spendStatus(c.actual, c.plan, c.kind === "income") || undefined}
      menu={
        <button type="button" className="kebab" aria-label={`${t.categoryMenu}: ${c.name}`} onClick={() => setEditing(c)}>
          ⋮
        </button>
      }
      detailLabel={t.itemsCount(c.transactions.length, c.kind === "income")}
      rows={<TxRows items={c.transactions} action={reassign} tone="project" />}
    />
  );

  return (
    <main>
      <header className="topnav">
        <button type="button" className="back c-project" aria-label={t.back} onClick={back}>
          <span className="arr">›</span>
        </button>
        <h1 className="ptitle c-project">{data?.project.name ?? ""}</h1>
        <span style={{ width: 44 }} />
      </header>
      <MonthSwitcher month={month} max={currentMonth()} onChange={(m) => navigate(`/projects/${id}?month=${m}`)} />
      {data && (
        <>
          <section className="card">
            <p className="hero-q">{t.projectHeroQuestion(month)}</p>
            <div className="hero-n">
              <Net agorot={data.net} />
            </div>
            <div className="two" style={{ marginBottom: 0 }}>
              <div>
                <div className="lbl">{t.expectedExpenses}</div>
                <div className="amt c-project">
                  <Money agorot={data.expenses.expected} />
                </div>
              </div>
              <div className="end">
                <div className="lbl">{t.expectedIncome}</div>
                <div className="amt c-income">
                  <Money agorot={data.income.expected} />
                </div>
              </div>
            </div>
          </section>
          <div className="sect">{t.expenses}</div>
          {data.categories.filter((c) => c.kind === "expense").map(card)}
          <div className="sect">{t.income}</div>
          {data.categories.filter((c) => c.kind === "income").map(card)}
          <button type="button" className="addcat" onClick={() => setAdding(true)}>
            {t.addCategory}
          </button>
        </>
      )}

      {failed && <LoadFailed onRetry={reload} />}
      {toast && <Toast text={toast} onClose={() => setToast("")} />}
      {reassigning && data && (
        <ReassignSheet
          tx={reassigning}
          data={data}
          onClose={() => setReassigning(null)}
          onDone={(msg) => {
            setReassigning(null);
            if (msg) setToast(msg);
            reload();
          }}
        />
      )}
      {editing && data && (
        <PlanModal
          project={data.project.name}
          category={editing}
          month={month}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {adding && data && (
        <NewCategoryModal
          projectId={id}
          project={data.project.name}
          month={month}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </main>
  );
}

function ReassignSheet({ tx, data, onClose, onDone }: { tx: Tx; data: ProjectMonth; onClose: () => void; onDone: (toast?: string) => void }) {
  const kind = tx.income ? "income" : "expense";
  const [choice, setChoice] = useState<number | null>(tx.projectCategoryId);
  const [otherProjects, setOtherProjects] = useState<Project[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const run = async (body: object, toast?: string) => {
    try {
      await api.post(`/api/transactions/${encodeURIComponent(tx.id)}/reassign`, body);
      onDone(toast);
      return true;
    } catch {
      setError(t.genericError);
      return false;
    }
  };
  if (adding) {
    return (
      <NewCategoryModal
        projectId={data.project.id}
        project={data.project.name}
        month={data.month}
        fixedKind={kind}
        onClose={() => setAdding(false)}
        onDone={async (id) => {
          // The error shows on the sheet, so go back to it if the move fails.
          if (!id || !(await run({ projectCategoryId: id }))) setAdding(false);
        }}
      />
    );
  }
  return (
    <Sheet onClose={onClose} label={t.whichCategory}>
      <div className="shead">
        <div className="k">{t.projectItem(data.project.name)}</div>
        <div className="big">
          <Money agorot={tx.amount} />
        </div>
        <div className="s">
          {tx.merchant} · {shortDate(tx.date)}
          {tx.account ? ` · ${tx.account}` : ""}
        </div>
      </div>
      {otherProjects ? (
        <div className="sbody" role="radiogroup" aria-label={t.whichProject}>
          <p className="q">{t.whichProject}</p>
          {otherProjects.map((p) => (
            <Option key={p.id} checked={false} onSelect={() => run({ projectId: p.id }, t.movedToast(p.name))}>
              {p.name}
            </Option>
          ))}
          {error && <div className="error">{error}</div>}
        </div>
      ) : (
        <div className="sbody" role="radiogroup" aria-label={t.whichCategory}>
          <p className="q">{t.whichCategory}</p>
          {data.categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <Option key={c.id} checked={choice === c.id} onSelect={() => setChoice(c.id)}>
                {c.name}
              </Option>
            ))}
          <button type="button" className="opt add" onClick={() => setAdding(true)}>
            {t.newCategory}
          </button>
          {error && <div className="error">{error}</div>}
          <button type="button" className="btn" disabled={choice === null || choice === tx.projectCategoryId} onClick={() => run({ projectCategoryId: choice })}>
            {t.save}
          </button>
          <div className="links">
            <button
              type="button"
              onClick={() =>
                api.get<{ projects: Project[] }>("/api/projects").then(
                  (r) => setOtherProjects(r.projects.filter((p) => p.status === "active" && p.id !== data.project.id)),
                  () => setError(t.genericError),
                )
              }
            >
              {t.moveToOtherProject}
            </button>
            <button type="button" onClick={() => run({ toOngoing: true }, t.returnedToast)}>
              {t.returnToOngoing}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PlanModal({ project, category, month, onClose, onDone }: { project: string; category: Category; month: string; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(String(category.plan / 100)); // exact: agorot survive a save
  const [error, setError] = useState("");
  const income = category.kind === "income";
  const save = async () => {
    const amount = parseShekels(value);
    if (amount === null) return setError(t.genericError);
    try {
      await api.put(`/api/project-categories/${category.id}/plans/${month}`, { amount });
      onDone();
    } catch {
      setError(t.genericError);
    }
  };
  return (
    <Modal onClose={onClose} label={category.name}>
      <div className="mhead">
        <div className="k">{project} · קטגוריה</div>
        <div className="t">{category.name}</div>
      </div>
      <div className="mbody">
        <p className="q">{t.planQuestion(category.name, month, income)}</p>
        <AmountInput value={value} onChange={setValue} label={t.planQuestion(category.name, month, income)} />
        <div className="help">{t.spentSoFar(plainWhole(category.actual))}</div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" onClick={save}>
          {t.updatePlan}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </Modal>
  );
}

function NewCategoryModal(props: {
  projectId: number;
  project: string;
  month: string;
  fixedKind?: "expense" | "income";
  onClose: () => void;
  onDone: (id?: number) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">(props.fixedKind ?? "expense");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    const plan = value.trim() === "" ? 0 : parseShekels(value);
    if (!name.trim() || plan === null) return setError(t.genericError);
    try {
      const { id } = await api.post<{ id: number }>(`/api/projects/${props.projectId}/categories`, { name: name.trim(), kind, month: props.month, plan });
      props.onDone(id);
    } catch {
      setError(t.genericError);
    }
  };
  return (
    <Modal onClose={props.onClose} label={t.newCategoryTitle}>
      <div className="mhead">
        <div className="k">{props.project}</div>
        <div className="t">{t.newCategoryTitle}</div>
      </div>
      <div className="mbody">
        <label className="flabel first" htmlFor="cat-name">
          {t.categoryName}
        </label>
        <div className="inp txt">
          <input id="cat-name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!props.fixedKind && (
          <>
            <div className="flabel">{t.kind}</div>
            <div className="seg" role="radiogroup" aria-label={t.kind}>
              <button type="button" role="radio" aria-checked={kind === "expense"} onClick={() => setKind("expense")}>
                {t.expense}
              </button>
              <button type="button" role="radio" aria-checked={kind === "income"} onClick={() => setKind("income")}>
                {t.incomeKind}
              </button>
            </div>
          </>
        )}
        <div className="flabel">{t.expectedThisMonth(props.month, kind === "income")}</div>
        <AmountInput value={value} onChange={setValue} label={t.expectedThisMonth(props.month, kind === "income")} />
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" onClick={save}>
          {t.addCategoryButton}
        </button>
        <button type="button" className="ghost" onClick={props.onClose}>
          {t.cancel}
        </button>
      </div>
    </Modal>
  );
}
