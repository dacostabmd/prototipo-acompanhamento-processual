-- CRM jurídico interno — pipelines FIXOS por departamento (seed via migration, não editáveis
-- pelo usuário final na v1), inspirados na estrutura real do Bitrix24 do escritório (mapeada
-- via MCP em 2026-10-07): 1 pipeline por área jurídica com etapas fixas, em vez do modelo
-- 100% configurável (ap_crm_pipelines/etapas/campos livres) implementado e removido em
-- 2026-10-06. A "régua de dias sem movimentação" vista no Bitrix (Dia 1 a 3 ... Dia 31) não
-- vira etapas de pipeline aqui — vira campo calculado a partir de ap_processos.ultima_movimentacao_em,
-- mantido pelo motor de reconsulta noturna (fase seguinte).
--
-- ap_crm_itens referencia ap_processos via FK opcional (processo_id): evita duas fontes de
-- verdade para "qual a última movimentação" — o card do CRM não duplica esse dado.
--
-- Resíduo da Fase 1 anterior (removida em 2026-10-06) ainda existe no banco remoto, todas com
-- 0 linhas: ap_crm_pipelines/ap_crm_pipeline_etapas/ap_crm_pipeline_campos/ap_crm_itens/
-- ap_crm_tentativas/ap_crm_tipos_campo, com id uuid (modelo configurável). Colidem em nome com
-- as tabelas fixas abaixo (ap_crm_pipelines/ap_crm_itens com id text) — dropadas por estarem
-- vazias e por decisão consciente do usuário de abandonar o modelo configurável.
drop table if exists public.ap_crm_tentativas cascade;
drop table if exists public.ap_crm_itens cascade;
drop table if exists public.ap_crm_pipeline_campos cascade;
drop table if exists public.ap_crm_tipos_campo cascade;
drop table if exists public.ap_crm_pipeline_etapas cascade;
drop table if exists public.ap_crm_pipelines cascade;
drop function if exists public.ap_crm_pode_acessar() cascade;

-- ── Departamentos (fixos, espelham os times reais vistos no Bitrix: Relacionamento ao
--    Cliente tem Analistas/Diretor/Jurídico/Financeiro/Negociação como papéis distintos) ──
create table public.ap_departamentos (
  id     text primary key,
  nome   text not null,
  ordem  integer not null default 0
);

insert into public.ap_departamentos (id, nome, ordem) values
  ('juridico',    'Jurídico',    1),
  ('financeiro',  'Financeiro',  2),
  ('comercial',   'Comercial',   3),
  ('negociacao',  'Negociação',  4),
  ('atendimento', 'Atendimento', 5);

create table public.ap_departamento_membros (
  departamento_id  text not null references public.ap_departamentos(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  papel            text not null default 'membro' check (papel in ('membro', 'lider')),
  created_at       timestamptz not null default now(),
  primary key (departamento_id, user_id)
);

-- ── Pipelines fixos por área jurídica/departamento ──────────────────────────────────────
create table public.ap_crm_pipelines (
  id               text primary key,
  nome             text not null,
  departamento_id  text not null references public.ap_departamentos(id),
  ordem            integer not null default 0,
  ativo            boolean not null default true
);

insert into public.ap_crm_pipelines (id, nome, departamento_id, ordem) values
  ('andamento_processual', 'Andamento Processual',     'juridico',    1),
  ('trabalhista',          'Trabalhista',               'juridico',    2),
  ('tributario',           'Tributário',                'juridico',    3),
  ('vara_familiar',        'Vara Familiar',              'juridico',    4),
  ('criminal',             'Criminal',                   'juridico',    5),
  ('previdenciario',       'Previdenciário',             'juridico',    6),
  ('processo_estrategico', 'Processo Estratégico',       'juridico',    7),
  ('cobranca_financeiro',  'Cobrança / Financeiro',      'financeiro',  8),
  ('relacionamento_cliente','Relacionamento ao Cliente', 'atendimento', 9);

-- ── Etapas fixas por pipeline (seed) ─────────────────────────────────────────────────────
create table public.ap_crm_etapas (
  id           text primary key,
  pipeline_id  text not null references public.ap_crm_pipelines(id) on delete cascade,
  nome         text not null,
  ordem        integer not null,
  cor          text,
  eh_final     boolean not null default false,
  unique (pipeline_id, ordem)
);

-- Régua padrão (Bitrix: Elaborar Processo → Pendenciado → Acompanhamento → Aguardando
-- Correção → Aguardando Assinatura → Protocolo → Onboarding 10 dias → Bem/Mal sucedido),
-- repetida nos pipelines jurídicos que seguem o mesmo ciclo de vida.
insert into public.ap_crm_etapas (id, pipeline_id, nome, ordem, cor, eh_final) values
  -- andamento_processual
  ('ap_elaborar',     'andamento_processual', 'Elaborar Processo',           1, '#8a7148', false),
  ('ap_pendenciado',  'andamento_processual', 'Pendenciado',                 2, '#c4a86f', false),
  ('ap_acompanhamento','andamento_processual','Acompanhamento',              3, '#60a5fa', false),
  ('ap_correcao',     'andamento_processual', 'Aguardando Correção',         4, '#fbbf24', false),
  ('ap_assinatura',   'andamento_processual', 'Aguardando Assinatura',       5, '#fbbf24', false),
  ('ap_protocolo',    'andamento_processual', 'Protocolo',                   6, '#a78bfa', false),
  ('ap_onboarding',   'andamento_processual', 'Onboarding (10 dias)',        7, '#a78bfa', false),
  ('ap_sucesso',      'andamento_processual', 'Bem-sucedido',                8, '#34d399', true),
  ('ap_falha',        'andamento_processual', 'Mal-sucedido',                9, '#f87171', true),
  -- trabalhista
  ('tr_elaborar',     'trabalhista', 'Elaborar Processo',       1, '#8a7148', false),
  ('tr_pendenciado',  'trabalhista', 'Pendenciado',             2, '#c4a86f', false),
  ('tr_acompanhamento','trabalhista','Acompanhamento',          3, '#60a5fa', false),
  ('tr_correcao',     'trabalhista', 'Aguardando Correção',     4, '#fbbf24', false),
  ('tr_protocolo',    'trabalhista', 'Protocolo',               5, '#a78bfa', false),
  ('tr_onboarding',   'trabalhista', 'Onboarding (10 dias)',    6, '#a78bfa', false),
  ('tr_sucesso',      'trabalhista', 'Bem-sucedido',            7, '#34d399', true),
  ('tr_falha',        'trabalhista', 'Mal-sucedido',            8, '#f87171', true),
  -- tributario (ciclo próprio: Revisão de Capag, Transação, Envio da DAS, Recuperação de crédito)
  ('tb_elaborar',     'tributario', 'Elaborar Processo',                               1, '#8a7148', false),
  ('tb_pendenciado',  'tributario', 'Pendenciado',                                     2, '#c4a86f', false),
  ('tb_acompanhamento','tributario','Acompanhamento',                                  3, '#60a5fa', false),
  ('tb_capag',        'tributario', 'Revisão de Capag',                                4, '#fbbf24', false),
  ('tb_transacao',    'tributario', 'Transação',                                       5, '#fbbf24', false),
  ('tb_das',          'tributario', 'Envio da DAS',                                    6, '#fbbf24', false),
  ('tb_recuperacao',  'tributario', 'Recuperação de Crédito',                          7, '#a78bfa', false),
  ('tb_onboarding',   'tributario', 'Onboarding (10 dias)',                            8, '#a78bfa', false),
  ('tb_sucesso',      'tributario', 'Bem-sucedido',                                    9, '#34d399', true),
  ('tb_falha',        'tributario', 'Mal-sucedido',                                   10, '#f87171', true),
  -- vara_familiar
  ('vf_elaborar',     'vara_familiar', 'Elaborar Processo',       1, '#8a7148', false),
  ('vf_pendenciado',  'vara_familiar', 'Pendenciado',             2, '#c4a86f', false),
  ('vf_acompanhamento','vara_familiar','Acompanhamento',          3, '#60a5fa', false),
  ('vf_correcao',     'vara_familiar', 'Aguardando Correção',     4, '#fbbf24', false),
  ('vf_assinatura',   'vara_familiar', 'Aguardando Assinatura',   5, '#fbbf24', false),
  ('vf_protocolo',    'vara_familiar', 'Protocolo',               6, '#a78bfa', false),
  ('vf_onboarding',   'vara_familiar', 'Onboarding (10 dias)',    7, '#a78bfa', false),
  ('vf_sucesso',      'vara_familiar', 'Bem-sucedido',            8, '#34d399', true),
  ('vf_falha',        'vara_familiar', 'Mal-sucedido',            9, '#f87171', true),
  -- criminal
  ('cr_elaborar',     'criminal', 'Elaborar Processo',       1, '#8a7148', false),
  ('cr_pendenciado',  'criminal', 'Pendenciado',             2, '#c4a86f', false),
  ('cr_acompanhamento','criminal','Acompanhamento',          3, '#60a5fa', false),
  ('cr_correcao',     'criminal', 'Aguardando Correção',     4, '#fbbf24', false),
  ('cr_assinatura',   'criminal', 'Aguardando Assinatura',   5, '#fbbf24', false),
  ('cr_protocolo',    'criminal', 'Protocolo',               6, '#a78bfa', false),
  ('cr_onboarding',   'criminal', 'Onboarding (10 dias)',    7, '#a78bfa', false),
  ('cr_sucesso',      'criminal', 'Bem-sucedido',            8, '#34d399', true),
  ('cr_falha',        'criminal', 'Mal-sucedido',            9, '#f87171', true),
  -- previdenciario
  ('pv_elaborar',     'previdenciario', 'Elaborar Processo',       1, '#8a7148', false),
  ('pv_pendenciado',  'previdenciario', 'Pendenciado',             2, '#c4a86f', false),
  ('pv_acompanhamento','previdenciario','Acompanhamento',          3, '#60a5fa', false),
  ('pv_correcao',     'previdenciario', 'Aguardando Correção',     4, '#fbbf24', false),
  ('pv_assinatura',   'previdenciario', 'Aguardando Assinatura',   5, '#fbbf24', false),
  ('pv_protocolo',    'previdenciario', 'Protocolo',               6, '#a78bfa', false),
  ('pv_onboarding',   'previdenciario', 'Onboarding (10 dias)',    7, '#a78bfa', false),
  ('pv_sucesso',      'previdenciario', 'Bem-sucedido',            8, '#34d399', true),
  ('pv_falha',        'previdenciario', 'Mal-sucedido',            9, '#f87171', true),
  -- processo_estrategico
  ('pe_elaborar',     'processo_estrategico', 'Elaborar Processo',       1, '#8a7148', false),
  ('pe_pendenciado',  'processo_estrategico', 'Pendenciado',             2, '#c4a86f', false),
  ('pe_acompanhamento','processo_estrategico','Acompanhamento',          3, '#60a5fa', false),
  ('pe_correcao',     'processo_estrategico', 'Aguardando Correção',     4, '#fbbf24', false),
  ('pe_assinatura',   'processo_estrategico', 'Aguardando Assinatura',   5, '#fbbf24', false),
  ('pe_protocolo',    'processo_estrategico', 'Protocolo',               6, '#a78bfa', false),
  ('pe_onboarding',   'processo_estrategico', 'Onboarding (10 dias)',    7, '#a78bfa', false),
  ('pe_sucesso',      'processo_estrategico', 'Bem-sucedido',            8, '#34d399', true),
  ('pe_falha',        'processo_estrategico', 'Mal-sucedido',            9, '#f87171', true),
  -- cobranca_financeiro (régua própria: Fazer Contato → Negociando → Renegociando → Pago → Concluído/Inadimplente)
  ('cf_contato',      'cobranca_financeiro', 'Fazer Contato',   1, '#8a7148', false),
  ('cf_negociando',   'cobranca_financeiro', 'Negociando',      2, '#c4a86f', false),
  ('cf_renegociando', 'cobranca_financeiro', 'Renegociando',    3, '#60a5fa', false),
  ('cf_pago',         'cobranca_financeiro', 'Pago',            4, '#fbbf24', false),
  ('cf_concluido',    'cobranca_financeiro', 'Concluído',       5, '#34d399', true),
  ('cf_inadimplente', 'cobranca_financeiro', 'Inadimplente',    6, '#f87171', true),
  -- relacionamento_cliente (atendimento/pós-venda/reversão)
  ('rc_novo',         'relacionamento_cliente', 'Nova Demanda',           1, '#8a7148', false),
  ('rc_analise',      'relacionamento_cliente', 'Em Análise',             2, '#c4a86f', false),
  ('rc_reversao',     'relacionamento_cliente', 'Tentativa de Reversão',  3, '#60a5fa', false),
  ('rc_retorno',      'relacionamento_cliente', 'Aguardando Retorno',     4, '#fbbf24', false),
  ('rc_resolvido',    'relacionamento_cliente', 'Resolvido',              5, '#34d399', true),
  ('rc_perdido',      'relacionamento_cliente', 'Não Revertido',          6, '#f87171', true);

-- ── Itens (cards) do CRM ──────────────────────────────────────────────────────────────────
create table public.ap_crm_itens (
  id                        uuid primary key default gen_random_uuid(),
  pipeline_id               text not null references public.ap_crm_pipelines(id),
  etapa_id                  text not null references public.ap_crm_etapas(id),
  processo_id               uuid references public.ap_processos(id) on delete set null,
  titulo                    text not null,
  cliente_nome              text,
  cliente_documento         text,
  advogado_responsavel_id   uuid references auth.users(id) on delete set null,
  uf                        char(2),
  valor_causa               numeric(16,2),
  situacao_financeira       text check (situacao_financeira is null or situacao_financeira in ('adimplente', 'inadimplente')),
  campos_extra              jsonb not null default '{}'::jsonb,
  criado_por                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index ap_crm_itens_pipeline_etapa_idx on public.ap_crm_itens (pipeline_id, etapa_id);
create index ap_crm_itens_processo_idx       on public.ap_crm_itens (processo_id);
create index ap_crm_itens_responsavel_idx    on public.ap_crm_itens (advogado_responsavel_id);

-- Auditoria de mudança de etapa (equivalente ao histórico de funil do Bitrix).
create table public.ap_crm_itens_historico (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.ap_crm_itens(id) on delete cascade,
  etapa_anterior_id   text references public.ap_crm_etapas(id),
  etapa_nova_id       text not null references public.ap_crm_etapas(id),
  movido_por          uuid references auth.users(id) on delete set null,
  movido_em           timestamptz not null default now()
);
create index ap_crm_itens_historico_item_idx on public.ap_crm_itens_historico (item_id, movido_em desc);

create trigger ap_crm_itens_touch before update on public.ap_crm_itens
  for each row execute function public.ap_touch_updated_at();

-- ── RBAC: pertencimento a departamento + role global (ap_perfis.role) ───────────────────
-- Acesso a um item: responsável direto, OU membro do departamento dono do pipeline, OU admin/owner.
create or replace function public.ap_crm_pode_acessar_item(p_item_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.ap_crm_itens i
    join public.ap_crm_pipelines p on p.id = i.pipeline_id
    where i.id = p_item_id
      and (
        i.advogado_responsavel_id = (select auth.uid())
        or exists (
          select 1 from public.ap_departamento_membros m
          where m.departamento_id = p.departamento_id and m.user_id = (select auth.uid())
        )
        or public.ap_is_admin()
      )
  );
$$;

-- Acesso de leitura geral a um pipeline (lista/kanban): membro do departamento ou admin/owner.
create or replace function public.ap_crm_pode_acessar_pipeline(p_pipeline_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ap_crm_pipelines p
    where p.id = p_pipeline_id
      and (
        exists (
          select 1 from public.ap_departamento_membros m
          where m.departamento_id = p.departamento_id and m.user_id = (select auth.uid())
        )
        or public.ap_is_admin()
      )
  );
$$;

alter table public.ap_departamentos        enable row level security;
alter table public.ap_departamento_membros enable row level security;
alter table public.ap_crm_pipelines        enable row level security;
alter table public.ap_crm_etapas           enable row level security;
alter table public.ap_crm_itens            enable row level security;
alter table public.ap_crm_itens_historico  enable row level security;

create policy ap_departamentos_read on public.ap_departamentos
  for select to authenticated using (true);

create policy ap_departamento_membros_read on public.ap_departamento_membros
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());
create policy ap_departamento_membros_admin_write on public.ap_departamento_membros
  for all to authenticated using (public.ap_is_admin()) with check (public.ap_is_admin());

create policy ap_crm_pipelines_read on public.ap_crm_pipelines
  for select to authenticated using (public.ap_crm_pode_acessar_pipeline(id));

create policy ap_crm_etapas_read on public.ap_crm_etapas
  for select to authenticated using (public.ap_crm_pode_acessar_pipeline(pipeline_id));

create policy ap_crm_itens_select on public.ap_crm_itens
  for select to authenticated using (public.ap_crm_pode_acessar_pipeline(pipeline_id));
create policy ap_crm_itens_insert on public.ap_crm_itens
  for insert to authenticated with check (public.ap_crm_pode_acessar_pipeline(pipeline_id));
create policy ap_crm_itens_update on public.ap_crm_itens
  for update to authenticated using (public.ap_crm_pode_acessar_item(id)) with check (public.ap_crm_pode_acessar_item(id));
create policy ap_crm_itens_delete on public.ap_crm_itens
  for delete to authenticated using (public.ap_is_admin());

create policy ap_crm_itens_historico_select on public.ap_crm_itens_historico
  for select to authenticated using (public.ap_crm_pode_acessar_item(item_id));
create policy ap_crm_itens_historico_insert on public.ap_crm_itens_historico
  for insert to authenticated with check (public.ap_crm_pode_acessar_item(item_id));
