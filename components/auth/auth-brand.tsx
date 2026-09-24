import { Building2, UsersRound } from "lucide-react";

export function AuthBrand() {
  return (
    <div className="auth-brand" aria-label="Administrativo CD — Gestão de pessoas e operação">
      <span className="auth-brand__mark" aria-hidden="true">
        <Building2 className="auth-brand__building" />
        <UsersRound className="auth-brand__people" />
      </span>
      <span className="auth-brand__copy">
        <strong>ADMINISTRATIVO <span>CD</span></strong>
        <small>Gestão de pessoas e operação</small>
      </span>
    </div>
  );
}
