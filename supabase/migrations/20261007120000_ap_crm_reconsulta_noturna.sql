-- Fase 2 do CRM jurídico: motor de reconsulta noturna (cron Vercel, 1x/dia) + alerta de
-- movimentação por e-mail. Esta migration adiciona só o que falta além do que a Fase 0
-- (20261007100000) já preparou em ap_processos (monitorar/ultima_consulta_em/proxima_consulta_em/
-- tentativas_consecutivas_sem_mudanca/erro_ultima_consulta):
--
-- 1) ap_configuracoes: tabela chave/valor genérica para configs ajustáveis sem redeploy (hoje só o
--    teto de orçamento diário do cron, mas serve para futuras configs do CRM sem nova migration).
-- 2) ap_alertas_pendentes: fila de alertas de movimentação a enviar (e-mail hoje; whatsapp fica
--    registrado como pendente mas não processado nesta fase — depende do Baileys, fase futura).
-- 3) ap_eventos.tipo ganha 'reconsulta_noturna' no CHECK, para o cron logar suas métricas de
--    batch (quantos processados, custo total, quantos deram erro) pelo mesmo trackEvento() já usado
--    em todo o resto do produto.

-- ── Configurações chave/valor do CRM (genérica, não só para o cron) ─────────────────────────
create table if not exists public.ap_configuracoes (
  chave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

create trigger ap_configuracoes_touch before update on public.ap_configuracoes
  for each row execute function public.ap_touch_updated_at();

-- Teto de orçamento diário do cron de reconsulta, em centavos (R$ 50,00/dia por padrão). Ajustável
-- em runtime via update nesta tabela, sem precisar de redeploy. O endpoint do cron também aceita um
-- fallback via env var RECONSULTA_ORCAMENTO_DIARIO_CENTAVOS quando esta linha não existir.
insert into public.ap_configuracoes (chave, valor)
values ('reconsulta_orcamento_diario_centavos', '5000'::jsonb)
on conflict (chave) do nothing;

alter table public.ap_configuracoes enable row level security;

-- Leitura/escrita só pelo servidor (service role, ignora RLS) e por admin/owner via painel futuro.
create policy ap_configuracoes_admin_read on public.ap_configuracoes
  for select to authenticated using (public.ap_is_admin());
create policy ap_configuracoes_admin_write on public.ap_configuracoes
  for all to authenticated using (public.ap_is_admin()) with check (public.ap_is_admin());

-- ── Fila de alertas de movimentação (gerada pelo cron, consumida pelo próprio cron) ─────────────
create table public.ap_alertas_pendentes (
  id           uuid primary key default gen_random_uuid(),
  processo_id  uuid not null references public.ap_processos(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  canal        text not null check (canal in ('email', 'whatsapp')),
  status       text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'ignorado')),
  tentativas   integer not null default 0,
  erro         text,
  enviado_em   timestamptz,
  created_at   timestamptz not null default now()
);
create index ap_alertas_pendentes_status_idx on public.ap_alertas_pendentes (status, created_at);
create index ap_alertas_pendentes_processo_idx on public.ap_alertas_pendentes (processo_id);

alter table public.ap_alertas_pendentes enable row level security;

-- Escrita só pelo servidor (service role). Leitura: dono do processo ou admin/owner.
create policy ap_alertas_pendentes_read on public.ap_alertas_pendentes
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());

-- ── ap_eventos.tipo ganha 'reconsulta_noturna' (métricas de cada execução do cron) ──────────────
alter table public.ap_eventos drop constraint if exists ap_eventos_tipo_check;
alter table public.ap_eventos add constraint ap_eventos_tipo_check
  check (tipo in ('login', 'logout', 'signup', 'consulta', 'resumo_ia', 'chat_ia', 'lead', 'page_view', 'automacao_bitrix', 'reconsulta_noturna'));
