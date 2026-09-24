export function AuthBrand() {
  return (
    <div className="auth-brand" aria-label="Administrativo CD — Gestão de pessoas e operação">
      <span className="auth-brand__mark" aria-hidden="true">
        <i className="auth-brand__person auth-brand__person--left" />
        <i className="auth-brand__person auth-brand__person--center" />
        <i className="auth-brand__person auth-brand__person--right" />
      </span>
      <span className="auth-brand__copy">
        <strong>ADMINISTRATIVO <span>CD</span></strong>
        <small>Gestão de pessoas e operação</small>
      </span>
    </div>
  );
}
