export default function DashboardsLoading() {
  return <div role="status" className="mx-auto max-w-[1440px] space-y-5 p-6 text-slate-600">
    <p className="text-sm font-medium">Carregando dashboard…</p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">{[0, 1, 2, 3].map((key) => <div key={key} className="h-32 rounded-xl border border-slate-200 bg-slate-100" />)}</div>
    <div className="h-72 rounded-xl border border-slate-200 bg-slate-100" aria-hidden="true" />
  </div>;
}
