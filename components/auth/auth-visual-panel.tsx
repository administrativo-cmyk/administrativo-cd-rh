import { BarChart3, CheckCircle2, ClipboardCheck, Database, Gauge, Leaf, Sparkles, UsersRound } from "lucide-react";

type AuthVisualPanelProps = {
  variant: "login" | "register";
};

const loginHighlights = [
  { icon: UsersRound, title: "Pessoas", text: "mais conectadas" },
  { icon: Gauge, title: "Operação", text: "mais fluida" },
  { icon: BarChart3, title: "Resultados", text: "mais claros" },
];

const registerHighlights = [
  { icon: UsersRound, title: "Gestão de pessoas", text: "rotinas mais simples" },
  { icon: ClipboardCheck, title: "Controle operacional", text: "processos organizados" },
  { icon: Database, title: "Informação centralizada", text: "um só ambiente" },
];

export function AuthVisualPanel({ variant }: AuthVisualPanelProps) {
  const isLogin = variant === "login";
  const highlights = isLogin ? loginHighlights : registerHighlights;

  return (
    <aside className={`auth-visual auth-visual--${variant}`} aria-label="Visão institucional do Administrativo CD">
      <span className="auth-visual__orb auth-visual__orb--one" aria-hidden="true" />
      <span className="auth-visual__orb auth-visual__orb--two" aria-hidden="true" />

      <div className="auth-visual__content">
        <span className="auth-visual__eyebrow"><Sparkles aria-hidden="true" /> Administrativo CD</span>
        <h2>
          {isLogin ? <>Pessoas fazem <strong>grandes conquistas.</strong></> : <>Comece hoje a construir um <strong>melhor amanhã.</strong></>}
        </h2>
        <p>
          {isLogin
            ? "Uma plataforma para simplificar a gestão de pessoas e apoiar a operação do dia a dia."
            : "Gestão de pessoas, informação e operação em um só ambiente."}
        </p>
      </div>

      <div className="auth-visual__scene" aria-hidden="true">
        <div className="auth-visual__ring auth-visual__ring--outer" />
        <div className="auth-visual__ring auth-visual__ring--inner" />
        <div className="auth-visual__center-card">
          <span className="auth-visual__center-icon"><UsersRound /></span>
          <span className="auth-visual__bar auth-visual__bar--long" />
          <span className="auth-visual__bar" />
          <div className="auth-visual__mini-metrics">
            <span /><span /><span />
          </div>
        </div>
        <span className="auth-visual__floating auth-visual__floating--a"><CheckCircle2 /></span>
        <span className="auth-visual__floating auth-visual__floating--b"><Leaf /></span>
        <span className="auth-visual__floating auth-visual__floating--c"><BarChart3 /></span>
      </div>

      <div className={`auth-highlights auth-highlights--${variant}`}>
        {highlights.map(({ icon: Icon, title, text }) => (
          <div className="auth-highlight" key={title}>
            <span className="auth-highlight__icon"><Icon aria-hidden="true" /></span>
            <span><strong>{title}</strong><small>{text}</small></span>
          </div>
        ))}
      </div>
    </aside>
  );
}
