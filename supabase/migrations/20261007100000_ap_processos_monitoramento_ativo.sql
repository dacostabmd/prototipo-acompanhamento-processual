-- Colunas de controle do motor de reconsulta periódica (cron noturno) em ap_processos: permitem
-- ligar/desligar o monitoramento por processo, saber quando foi a última/próxima consulta e aplicar
-- backoff crescente para processos que ficam muitas reconsultas seguidas sem nenhuma mudança.

alter table public.ap_processos
  add column if not exists monitorar boolean not null default true;

alter table public.ap_processos
  add column if not exists ultima_consulta_em timestamptz;

alter table public.ap_processos
  add column if not exists proxima_consulta_em timestamptz;

alter table public.ap_processos
  add column if not exists tentativas_consecutivas_sem_mudanca integer not null default 0;

alter table public.ap_processos
  add column if not exists erro_ultima_consulta text;

-- Índice parcial: só os processos elegíveis para reconsulta (monitorados e ainda ativos), ordenados
-- pela próxima consulta agendada — é a consulta que o cron vai fazer a cada execução.
create index if not exists ap_processos_proxima_consulta_idx
  on public.ap_processos (proxima_consulta_em)
  where monitorar and status = 'ativo';
