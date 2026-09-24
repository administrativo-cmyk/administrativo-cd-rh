import { BarChart3, Leaf, Settings, UsersRound } from "lucide-react";

type AuthVisualPanelProps = { variant: "login" | "register" };

const loginHighlights = [
  { icon: UsersRound, title: "Pessoas", text: "mais engajadas" },
  { icon: BarChart3, title: "Equipes", text: "mais produtivas" },
  { icon: Leaf, title: "Resultados", text: "mais sustentáveis" },
];

const registerHighlights = [
  { icon: UsersRound, title: "Gestão de talentos", text: "mais simples e eficiente" },
  { icon: Settings, title: "Processos de RH", text: "em um só lugar" },
  { icon: Leaf, title: "Ambientes de trabalho", text: "mais saudáveis" },
];

function LoginPeopleArt() {
  return (
    <svg className="auth-people-art auth-people-art--login" viewBox="0 0 560 390" role="img" aria-label="Equipe de profissionais reunida">
      <defs>
        <linearGradient id="login-shirt-green" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#18865a" /><stop offset="1" stopColor="#72b89b" /></linearGradient>
        <linearGradient id="login-shirt-blue" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#163f69" /><stop offset="1" stopColor="#3b76a7" /></linearGradient>
        <linearGradient id="login-bg" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f8fbfa" /><stop offset="1" stopColor="#dce9ec" /></linearGradient>
      </defs>
      <rect width="560" height="390" rx="28" fill="url(#login-bg)" />
      <circle cx="84" cy="66" r="72" fill="#d8eee3" opacity=".74" /><circle cx="495" cy="70" r="108" fill="#dcecf6" opacity=".78" />
      <path d="M0 272C104 228 182 251 271 277s177 29 289-15v128H0Z" fill="#edf4f5" />
      <g transform="translate(38 52)">
        <path d="M42 155c-4-69 22-119 75-119 57 0 78 49 72 119Z" fill="#2d1d1a" /><circle cx="116" cy="112" r="50" fill="#a66345" />
        <path d="M69 100c5-50 27-74 62-68 28 5 45 26 48 61-24-10-45-25-59-45-6 23-22 40-51 52Z" fill="#3a211c" />
        <path d="M36 310c3-101 34-153 82-153 52 0 84 56 89 153Z" fill="url(#login-shirt-green)" />
        <path d="M94 110c5 6 12 6 17 0M131 110c5 6 12 6 17 0M107 135c11 9 24 8 34-1" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="translate(224 98)">
        <path d="M31 117c0-58 27-91 70-91 46 0 75 37 71 91Z" fill="#172735" /><circle cx="103" cy="90" r="42" fill="#c8815c" />
        <path d="M61 79c12-35 32-52 62-45 18 4 31 18 37 38-34 4-61-5-81-25-2 14-8 25-18 32Z" fill="#28343a" />
        <path d="M40 292c4-91 27-142 69-142 48 0 73 50 78 142Z" fill="url(#login-shirt-blue)" />
        <g fill="none" stroke="#245b7e" strokeWidth="3"><circle cx="87" cy="91" r="14"/><circle cx="119" cy="91" r="14"/><path d="M101 91h4"/></g><path d="M91 116c9 7 19 7 27-1" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="translate(377 132)">
        <path d="M16 102c2-53 24-82 63-82s62 32 61 82Z" fill="#483028" /><circle cx="80" cy="77" r="38" fill="#bd7655" />
        <path d="M43 65c10-30 30-43 56-34 17 6 28 19 30 37-35-4-57-18-69-36-2 15-8 26-17 33Z" fill="#56352b" /><path d="M22 258c3-77 23-119 61-119 41 0 61 42 66 119Z" fill="#f4f7f8" />
        <path d="M67 101c8 6 17 6 24-1" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M188 323h300l32 67H157Z" fill="#d8e0e3" /><path d="M250 284h175l18 106H226Z" fill="#f7f9fa" stroke="#cad7dc" strokeWidth="3" /><circle cx="335" cy="335" r="8" fill="#b5c4ca" />
    </svg>
  );
}

function RegisterPeopleArt() {
  return (
    <svg className="auth-people-art auth-people-art--register" viewBox="0 0 560 360" role="img" aria-label="Profissionais colaborando em processos de recursos humanos">
      <defs><linearGradient id="register-board" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff" /><stop offset="1" stopColor="#eaf5f8" /></linearGradient></defs>
      <circle cx="114" cy="164" r="72" fill="#dcefeb" /><circle cx="470" cy="73" r="68" fill="#e4effa" />
      <rect x="122" y="42" width="312" height="205" rx="24" fill="url(#register-board)" stroke="#d9e8ee" strokeWidth="3" />
      <rect x="150" y="72" width="74" height="84" rx="13" fill="#e7f2fc" /><circle cx="187" cy="102" r="18" fill="#287dc1" /><path d="M160 145c5-22 15-32 27-32s23 10 27 32Z" fill="#287dc1" />
      <path d="M252 82h134M252 105h103" stroke="#c2d7e5" strokeWidth="10" strokeLinecap="round" /><rect x="249" y="135" width="154" height="82" rx="14" fill="#f4faf8" />
      <circle cx="281" cy="161" r="13" fill="#168e68" /><path d="M267 190c4-14 9-20 14-20 7 0 12 6 16 20Z" fill="#168e68" /><path d="M315 158h62M315 181h78" stroke="#c7dedc" strokeWidth="8" strokeLinecap="round" />
      <g transform="translate(22 132)"><circle cx="104" cy="51" r="31" fill="#a76347" /><path d="M74 44c5-31 21-45 45-39 17 4 26 17 27 35-28-7-42-17-52-31-2 14-9 26-20 35Z" fill="#21364a" /><path d="M62 212c3-79 18-119 47-119 34 0 49 41 52 119Z" fill="#2879bd" /><path d="M132 116l74-42" stroke="#a76347" strokeWidth="18" strokeLinecap="round" /><circle cx="207" cy="73" r="10" fill="#a76347" /></g>
      <g transform="translate(384 153)"><circle cx="66" cy="43" r="29" fill="#bf7857" /><path d="M38 38c3-29 18-44 40-39 18 4 28 18 29 39-23-6-39-16-49-29-2 13-8 23-20 29Z" fill="#183153" /><path d="M20 198c3-73 20-109 50-109 33 0 50 37 54 109Z" fill="#26a36b" /><rect x="-5" y="107" width="57" height="76" rx="6" fill="#1b3145" transform="rotate(-7)" /></g>
      <g transform="translate(226 216)"><circle cx="62" cy="35" r="27" fill="#bd7756" /><path d="M36 31c3-25 16-38 37-35 16 3 26 15 27 32-23-4-39-13-48-25-3 13-8 22-16 28Z" fill="#4b3029" /><path d="M17 137c3-54 18-83 48-83 31 0 47 29 50 83Z" fill="#f2f5f6" /><rect x="75" y="78" width="79" height="48" rx="6" fill="#667b89" /><rect x="82" y="84" width="65" height="34" rx="3" fill="#d7e6eb" /></g>
      <path d="M18 350h524" stroke="#c9dee1" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

export function AuthVisualPanel({ variant }: AuthVisualPanelProps) {
  const isLogin = variant === "login";
  const highlights = isLogin ? loginHighlights : registerHighlights;
  return (
    <aside className={`auth-visual auth-visual--${variant}`} aria-label="Visão institucional do Administrativo CD">
      <span className="auth-visual__curve" aria-hidden="true" />
      <div className="auth-visual__content">
        <h2>{isLogin ? <>Pessoas fazem <strong>grandes conquistas.</strong></> : <>Comece hoje<br />a construir um <strong>melhor amanhã.</strong></>}</h2>
        <p>{isLogin ? "Uma plataforma completa para simplificar a gestão de pessoas e fortalecer o que realmente importa." : "Mais do que gestão de pessoas, criamos oportunidades para talentos crescerem."}</p>
      </div>
      <div className="auth-visual__scene">{isLogin ? <LoginPeopleArt /> : <RegisterPeopleArt />}</div>
      <div className={`auth-highlights auth-highlights--${variant}`}>
        {highlights.map(({ icon: Icon, title, text }) => <div className="auth-highlight" key={title}><span className="auth-highlight__icon"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><small>{text}</small></span></div>)}
      </div>
    </aside>
  );
}
