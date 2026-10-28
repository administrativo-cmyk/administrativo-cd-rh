export default function AppLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] lg:pl-18" aria-busy="true" aria-label="Carregando página">
    <div className="h-16 border-b border-slate-200 bg-white" />
    <div className="mx-auto max-w-[1720px] animate-pulse space-y-5 p-3 sm:p-4 md:p-5">
      <div className="h-8 w-64 rounded-lg bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 rounded-xl border border-slate-200 bg-white" />)}
      </div>
      <div className="h-72 rounded-xl border border-slate-200 bg-white" />
      <p className="sr-only" role="status">Carregando conteúdo…</p>
    </div>
  </main>;
}
