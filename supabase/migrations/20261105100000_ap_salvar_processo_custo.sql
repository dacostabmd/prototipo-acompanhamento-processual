-- Salvar processo em "Meus processos" passa a ser opcional (dialog após a busca) e cada processo carrega o
-- custo da pesquisa que o encontrou. ap_historico_consultas.id passa a ser o consultaId do streaming
-- (app/api/processos/route.ts), o que permite ligar a busca, o processo pesquisado e o processo salvo.
--
-- custo_pesquisa = custo_cobrado da consulta rateado pelo número de processos encontrados nela.

alter table public.ap_processos_pesquisados
  add column if not exists consulta_id    uuid references public.ap_historico_consultas(id) on delete set null,
  add column if not exists custo_pesquisa numeric(10,2) not null default 0;

alter table public.ap_processos_monitorados
  add column if not exists consulta_id    uuid references public.ap_historico_consultas(id) on delete set null,
  add column if not exists custo_pesquisa numeric(10,2) not null default 0;

create index if not exists ap_processos_pesquisados_consulta_idx on public.ap_processos_pesquisados (consulta_id);
create index if not exists ap_processos_monitorados_consulta_idx on public.ap_processos_monitorados (consulta_id);
