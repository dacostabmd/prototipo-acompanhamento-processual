-- Adiciona controle de sensibilidade/anti-spam por monitoramento (feature/smart-digest-v2)
-- Permite escolher entre:
--   'smart_digest'     -> Alertas urgentes imediatos; atos de rotina consolidados na sexta-feira (padrão)
--   'todas'            -> Notificação imediata para qualquer movimentação
--   'urgentes_apenas'  -> Somente penhoras, prazos fatais e liminares (ignora rotina)

alter table public.ap_processos_monitorados 
  add column if not exists modo_sensibilidade text not null default 'smart_digest';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ap_processos_monitorados_sensibilidade_check') then
    alter table public.ap_processos_monitorados
      add constraint ap_processos_monitorados_sensibilidade_check 
      check (modo_sensibilidade in ('smart_digest', 'todas', 'urgentes_apenas'));
  end if;
end $$;

comment on column public.ap_processos_monitorados.modo_sensibilidade is 
  'smart_digest (urgente na hora, rotina semanal), todas (tudo imediato) ou urgentes_apenas (apenas penhora/prazo fatal)';
