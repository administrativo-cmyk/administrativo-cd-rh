"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, LoaderCircle } from "lucide-react";
import { supabaseAuthService } from "@/lib/auth/supabase-auth-service";
import type { AuthService } from "@/lib/auth/auth-service";
import { cn } from "@/lib/utils";

export function LogoutButton({ className, compact = false, service = supabaseAuthService }: { className?: string; compact?: boolean; service?: AuthService }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await service.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={handleLogout} disabled={loading} className={cn(className)}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
      {compact ? null : "Sair"}
    </button>
  );
}
