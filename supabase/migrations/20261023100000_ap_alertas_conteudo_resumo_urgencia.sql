-- Worker de fila de alertas + resumo IA por movimentação (feature/acompanhamento-ia).
-- Só aditiva: nenhuma tabela, coluna ou função é removida.

-- Snapshot do que o alerta vai enviar (processo, movimentações novas, resumo IA), gravado na hora em
-- que o cron enfileira: o worker não depende de joins nem de "quais movimentações eram novas".
alter table public.ap_alertas_pendentes add column if not exists conteudo jsonb;
alter table public.ap_alertas_pendentes add column if not exists ultima_tentativa_em timestamptz;

comment on column public.ap_alertas_pendentes.conteudo is
  '{numeroCnj, tribunal, movimentos:[{data,titulo,descricao}], resumo:{resumo,significado,proximoPasso,urgencia}|null}';

-- Fila do worker: pendentes e falhas ainda elegíveis a nova tentativa, por ordem de chegada.
create index if not exists ap_alertas_pendentes_fila_idx
  on public.ap_alertas_pendentes (created_at)
  where status in ('pendente', 'falhou');

-- Urgência classificada pela IA (baixa/media/alta), para o painel de alertas e a ordenação no app.
alter table public.ap_resumos_ia add column if not exists urgencia text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ap_resumos_ia_urgencia_check') then
    alter table public.ap_resumos_ia
      add constraint ap_resumos_ia_urgencia_check check (urgencia is null or urgencia in ('baixa', 'media', 'alta'));
  end if;
end $$;

create index if not exists ap_resumos_ia_processo_recente_idx on public.ap_resumos_ia (processo_id, created_at desc);
