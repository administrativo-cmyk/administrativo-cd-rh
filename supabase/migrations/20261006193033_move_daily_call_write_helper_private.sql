-- The privileged implementation is not an exposed Data API endpoint.
create schema chamada_privada;
revoke all on schema chamada_privada from public, anon, authenticated;
grant usage on schema chamada_privada to authenticated;

alter function public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  set schema chamada_privada;
revoke all on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  from public, anon, authenticated;
grant execute on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  to authenticated;

-- The exposed wrapper has no elevated privileges. The private helper repeats
-- the ADMIN check before touching any protected table.
create function public.salvar_chamada_diaria(
  p_colaborador_id uuid, p_data date, p_status public.codigo_chamada,
  p_observacao text, p_expected_updated_at timestamptz
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select chamada_privada.salvar_chamada_diaria(
    p_colaborador_id, p_data, p_status, p_observacao, p_expected_updated_at
  );
$$;
revoke all on function public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  to authenticated;
