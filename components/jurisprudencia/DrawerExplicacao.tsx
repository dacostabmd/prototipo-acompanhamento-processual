'use client';

import { useEffect, useRef, useState } from 'react';
import { Drawer } from '@mantine/core';
import { AlertCircle, ExternalLink, Scale, Sparkles } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { formatarDataBR, type ItemJurisprudencia } from './utils';

interface Estado {
  carregando: boolean;
  explicacao: string | null;
  erro: string | null;
  proOnly: boolean;
}

const INICIAL: Estado = { carregando: false, explicacao: null, erro: null, proOnly: false };

/** A explicação vem em linhas "Rótulo: texto"; separa para exibir cada parte com seu título. */
function dividir(explicacao: string): Array<{ rotulo: string | null; texto: string }> {
  return explicacao
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = /^(Do que se trata|O que foi decidido)\s*:\s*(.+)$/i.exec(l);
      return m ? { rotulo: m[1], texto: m[2] } : { rotulo: null, texto: l };
    });
}

export function DrawerExplicacao({
  item,
  onClose,
  onRecursoPro
}: {
  item: ItemJurisprudencia | null;
  onClose: () => void;
  onRecursoPro: () => void;
}) {
  const [estado, setEstado] = useState<Estado>(INICIAL);
  const cache = useRef(new Map<string, string>());

  useEffect(() => {
    if (!item) return;
    const guardada = cache.current.get(item.id);
    if (guardada) {
      setEstado({ ...INICIAL, explicacao: guardada });
      return;
    }
    let cancelado = false;
    setEstado({ ...INICIAL, carregando: true });
    (async () => {
      try {
        const res = await authFetch('/api/jurisprudencia/explicar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id })
        });
        const data = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok) {
          if (data.codigo === 'recurso_pro') {
            setEstado({ ...INICIAL, proOnly: true });
            onRecursoPro();
            return;
          }
          setEstado({ ...INICIAL, erro: data.error || 'Não foi possível gerar a explicação agora.' });
          return;
        }
        cache.current.set(item.id, data.explicacao);
        setEstado({ ...INICIAL, explicacao: data.explicacao });
      } catch {
        if (!cancelado) setEstado({ ...INICIAL, erro: 'Falha de conexão. Tente novamente em instantes.' });
      }
    })();
    return () => {
      cancelado = true;
    };
    // onRecursoPro é estável o bastante para este uso; reexecutar a cada render geraria chamadas repetidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  return (
    <Drawer
      opened={!!item}
      onClose={onClose}
      position="right"
      size="lg"
      padding="lg"
      title={
        item && (
          <span className="block">
            <span className="block text-base font-semibold text-white">{item.referencia}</span>
            {item.orgaoJulgador && <span className="block text-xs text-white/50">{item.orgaoJulgador}</span>}
          </span>
        )
      }
    >
      {item && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[#1E7CF2]/25 bg-[#1E7CF2]/[0.06] px-3.5 py-3">
            <p className="m-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#1E7CF2]">
              <Sparkles size={11} />
              Em linguagem simples
            </p>
            {estado.carregando && <p className="mb-0 mt-2 animate-pulse text-sm text-white/70">Preparando a explicação...</p>}
            {estado.erro && (
              <p className="mb-0 mt-2 inline-flex items-start gap-1.5 text-sm text-red-300">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {estado.erro} Leia a ementa original abaixo.
              </p>
            )}
            {estado.proOnly && <p className="mb-0 mt-2 text-sm text-white/70">A explicação em linguagem simples é um recurso do Plano Pro.</p>}
            {estado.explicacao && (
              <div className="mt-2 space-y-2.5">
                {dividir(estado.explicacao).map((p, i) => (
                  <p key={i} className="m-0 text-sm leading-relaxed text-white/85">
                    {p.rotulo && <strong className="block text-xs font-semibold text-white/60">{p.rotulo}</strong>}
                    {p.texto}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
            <p className="m-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
              <Scale size={11} />
              Ementa original (para advogados)
            </p>
            <p className="mb-0 mt-2 whitespace-pre-line break-words text-xs leading-relaxed text-white/70">{item.ementa}</p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
            <span>{item.dataJulgamento ? `Julgado em ${formatarDataBR(item.dataJulgamento)}` : ''}</span>
            {item.fonteUrl && (
              <a
                href={item.fonteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[#1E7CF2] no-underline hover:underline"
              >
                <ExternalLink size={13} />
                Ler o inteiro teor no {item.tribunal}
              </a>
            )}
          </div>

          <p className="m-0 text-[11px] text-white/40">
            Explicação gerada por IA com base apenas na ementa. Não substitui a leitura do inteiro teor nem a orientação de um advogado.
          </p>
        </div>
      )}
    </Drawer>
  );
}
