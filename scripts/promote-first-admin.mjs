import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secretKey) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY somente no ambiente local antes de executar o bootstrap.");
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { count: adminCount, error: adminError } = await supabase
  .from("perfis")
  .select("id", { count: "exact", head: true })
  .eq("papel_usuario", "ADMIN");

if (adminError) throw new Error("Não foi possível verificar a existência de ADMIN.");
if ((adminCount ?? 0) > 0) throw new Error("O bootstrap foi cancelado porque já existe um ADMIN.");

const { data: pendingProfiles, error: pendingError } = await supabase
  .from("perfis")
  .select("id,nome_completo,cpf_normalizado")
  .eq("status_usuario", "PENDENTE")
  .order("created_at", { ascending: true });

if (pendingError) throw new Error("Não foi possível consultar os cadastros pendentes.");
if (!pendingProfiles?.length) throw new Error("O bootstrap exige pelo menos um cadastro PENDENTE.");

let target = process.env.FIRST_ADMIN_USER_ID
  ? pendingProfiles.find((profile) => profile.id === process.env.FIRST_ADMIN_USER_ID)
  : pendingProfiles.length === 1 ? pendingProfiles[0] : undefined;

if (!target) {
  const prompt = createInterface({ input, output });
  const identifier = (await prompt.question("Informe o UUID ou CPF do cadastro PENDENTE que será o primeiro ADMIN: ")).trim();
  const normalizedCPF = identifier.replace(/\D/g, "");
  prompt.close();
  target = pendingProfiles.find((profile) => profile.id === identifier || profile.cpf_normalizado === normalizedCPF);
}

if (!target) throw new Error("Cadastro PENDENTE não encontrado para o identificador informado.");

const { data: promoted, error: promotionError } = await supabase
  .from("perfis")
  .update({
    status_usuario: "APROVADO",
    papel_usuario: "ADMIN",
    aprovado_em: new Date().toISOString(),
    aprovado_por: null,
  })
  .eq("id", target.id)
  .eq("status_usuario", "PENDENTE")
  .select("id")
  .single();

if (promotionError || !promoted) throw new Error("A promoção não foi aplicada; nenhum perfil foi alterado.");

console.log("Primeiro ADMIN promovido com sucesso. Nenhuma senha ou credencial foi exibida.");
