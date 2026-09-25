import Link from "next/link";
import { Ban, Clock3 } from "lucide-react";
import { AuthBrand } from "@/components/auth/auth-brand";
import { LogoutButton } from "@/components/auth/logout-button";

type AccessStatusProps = {
  variant: "pending" | "blocked";
};

const content = {
  pending: {
    title: "Seu acesso está aguardando aprovação.",
    description: "Assim que seu cadastro for aprovado, você poderá acessar o Administrativo CD.",
    Icon: Clock3,
  },
  blocked: {
    title: "Seu acesso está bloqueado.",
    description: "Procure a administração responsável para revisar seu acesso.",
    Icon: Ban,
  },
} as const;

export function AccessStatus({ variant }: AccessStatusProps) {
  const { title, description, Icon } = content[variant];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e9f7f1,transparent_38%),linear-gradient(135deg,#f8fbfd,#eef6fb)] px-4 py-10 text-slate-900">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-white/80 bg-white/95 px-7 py-10 text-center shadow-[0_24px_80px_rgba(35,74,107,0.14)] sm:px-12">
          <div className="mx-auto mb-8 flex justify-center"><AuthBrand /></div>
          <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${variant === "pending" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>
            <Icon size={30} aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-[#071432] sm:text-3xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <LogoutButton className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60" />
            <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Voltar para o login
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
