insert into public.unidades (codigo, nome, ativo)
values
  ('CD I', 'CD I', true),
  ('CD II', 'CD II', true),
  ('CD FLV', 'CD FLV', true)
on conflict (codigo) do update
set
  nome = excluded.nome,
  ativo = excluded.ativo;
