-- Cache de tentativas de enriquecimento (InfoSimples/DataJud) por deal, usado como fallback do
-- Redis (Upstash é opcional neste projeto). Evita reprocessar o mesmo deal/número de processo
-- por 7 dias quando nenhum dado foi encontrado, sem precisar persistir "lixo" em ap_automacao_deals
-- (que só guarda deals efetivamente enriquecidos).
create table public.ap_automacao_tentativas (
  id            uuid primary key default gen_random_uuid(),
  regra_id      uuid not null references public.ap_automacao_regras(id) on delete cascade,
  deal_id       integer not null,
  numero_cnj    text,
  tentado_em    timestamptz not null default now(),
  unique (regra_id, deal_id)
);
create index ap_automacao_tentativas_regra_idx on public.ap_automacao_tentativas (regra_id, tentado_em desc);

alter table public.ap_automacao_tentativas enable row level security;

-- Só o servidor (service role) lê/escreve — não há necessidade de exposição via RLS a usuários.
create policy ap_automacao_tentativas_none on public.ap_automacao_tentativas
  for select to authenticated using (false);
