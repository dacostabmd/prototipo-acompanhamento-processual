'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@mantine/core';
import { Coins } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Consumo {
  franquiaReais: number;
  usadoReais: number;
  restanteReais: number;
  percentualUsado: number;
  renovaEm: string;
}

/** Evento para forçar a atualização do indicador (ex.: logo após uma busca paga). */
export const EVENTO_CREDITOS = 'bf:creditos-atualizar';

const brl = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatarData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Indicador da franquia mensal de consultas pagas (APIs de terceiros): quanto já foi usado, quanto resta
 * e quando renova. Fica no topo do shell, ao lado do zoom. Clicar leva à página de planos.
 */
export default function CreditosChip() {
  const pathname = usePathname();
  const [consumo, setConsumo] = useState<Consumo | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await authFetch('/api/planos');
      if (!res.ok) return;
      const dados = await res.json();
      if (dados?.consumo) setConsumo(dados.consumo);
    } catch {}
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar, pathname]);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar();
    };
    window.addEventListener(EVENTO_CREDITOS, carregar);
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.removeEventListener(EVENTO_CREDITOS, carregar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [carregar]);

  if (!consumo) return null;

  const restantePct = Math.max(0, 100 - consumo.percentualUsado);
  const nivel = consumo.percentualUsado >= 90 ? 'critico' : consumo.percentualUsado >= 70 ? 'atencao' : 'ok';
  const esgotado = consumo.restanteReais <= 0;

  const dica = esgotado
    ? `Franquia do mês esgotada. Renova em ${formatarData(consumo.renovaEm)}. Faça upgrade para continuar consultando.`
    : `Usado ${brl(consumo.usadoReais)} de ${brl(consumo.franquiaReais)} em consultas pagas. Renova em ${formatarData(consumo.renovaEm)}.`;

  return (
    <Tooltip label={dica} multiline w={260} withArrow>
      <Link
        href="/planos"
        className="bf-creditos"
        data-tour="creditos"
        data-nivel={nivel}
        aria-label={`Créditos de consulta: ${brl(consumo.restanteReais)} restantes. ${dica}`}
      >
        <Coins size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="bf-creditos-texto">
          <span className="bf-creditos-valor">{esgotado ? 'Sem créditos' : `${brl(consumo.restanteReais)} restantes`}</span>
          <span className="bf-creditos-barra" aria-hidden="true">
            <span className="bf-creditos-preenchimento" style={{ width: `${restantePct}%` }} />
          </span>
        </span>
      </Link>
    </Tooltip>
  );
}
