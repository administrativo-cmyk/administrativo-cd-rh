"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { formatCPF, normalizeCPF } from "@/lib/auth/cpf";

type CpfFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (normalizedValue: string) => void;
  onBlur?: () => void;
  error?: string;
  autoFocus?: boolean;
  autoComplete?: "username" | "off";
  preventAutofill?: boolean;
};

export function CpfField({ id, label, value, onChange, onBlur, error, autoFocus, autoComplete = "username", preventAutofill = false }: CpfFieldProps) {
  const [readOnly, setReadOnly] = useState(preventAutofill);
  const errorId = `${id}-error`;

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input-wrap${error ? " auth-input-wrap--error" : ""}`}>
        <UserRound aria-hidden="true" />
        <input
          id={id}
          name="cpf"
          type="text"
          inputMode="numeric"
          autoComplete={autoComplete}
          placeholder="Digite seu CPF"
          value={formatCPF(value)}
          onChange={(event) => onChange(normalizeCPF(event.target.value))}
          onFocus={() => setReadOnly(false)}
          onBlur={onBlur}
          readOnly={readOnly}
          maxLength={14}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          autoFocus={autoFocus}
        />
      </div>
      {error ? <p className="auth-field__error" id={errorId}>{error}</p> : null}
    </div>
  );
}
