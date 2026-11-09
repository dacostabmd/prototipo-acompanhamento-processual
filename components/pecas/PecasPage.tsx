'use client';

import { useState } from 'react';
import { Crown, FileText, History, Lock, PenLine, Scale } from 'lucide-react';
import AbasDeslizantes from '@/components/AbasDeslizantes';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import { EditorPeca } from './EditorPeca';
import { HistoricoPecas } from './HistoricoPecas';
import { NovaPeca } from './NovaPeca';
import { BOTAO_SEC, paraEditavel, type PecaEditavel } from './pecasUi';

type Aba = 'redigir' | 'historico';

const MSG_RESTRITO =
  'Os modelos de peças são restritos a advogados. A consulta avulsa serve para acompanhar processos; para redigir peças, procure um advogado ou cadastre-se com perfil de advogado.';

export function PecasPage() {
  const { profile } = useSharedProfile();
  const privilegiado = profile.role === 'owner' || profile.role === 'admin';
  const semAcesso = profile.plano !== 'pro' && !privilegiado;

  const [aba, setAba] = useState<Aba>('redigir');
  const [peca, setPeca] = useState<PecaEditavel | null>(null);
  const [versaoHistorico, setVersaoHistorico] = useState(0);
  const [modalPro, setModalPro] = useState(false);
  // Mensagem devolvida pela API (409); o perfil pode chegar depois do primeiro render, então o role também decide.
  const [restritoApi, setRestritoApi] = useState<string | null>(null);
  const restritoMensagem = restritoApi ?? (profile.role === 'cliente' ? MSG_RESTRITO : null);

  if (restritoMensagem) {
    return (
      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-sm sm:p-10">
        <Lock size={28} className="mx-auto text-white/40" />
        <h2 className="mb-0 mt-3 text-lg font-semibold text-white">Recurso restrito a advogados</h2>
        <p className="mx-auto mb-0 mt-2 max-w-xl text-sm leading-relaxed text-white/60">{restritoMensagem}</p>
      </section>
    );
  }

  const abrir = (p: PecaEditavel) => {
    setPeca(p);
    setAba('redigir');
    setVersaoHistorico(v => v + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {semAcesso && (
        <div className="bf-paper mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 p-4 sm:p-5">
          <p className="m-0 inline-flex items-start gap-2 text-sm text-white/80">
            <Crown size={17} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
            Os modelos de peças com IA são um recurso do Plano Pro. Veja abaixo como funciona; para gerar minutas, conheça o Plano Pro.
          </p>
          <button type="button" onClick={() => setModalPro(true)} className={`${BOTAO_SEC} text-xs`}>
            <Crown size={14} className="text-[#1E7CF2]" />
            Conhecer o Plano Pro
          </button>
        </div>
      )}

      <div className="mb-4">
        <AbasDeslizantes<Aba>
          value={aba}
          onChange={setAba}
          ariaLabel="Seção de peças"
          data={[
            {
              value: 'redigir',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <PenLine size={15} /> Redigir
                </span>
              )
            },
            {
              value: 'historico',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <History size={15} /> Histórico
                </span>
              )
            }
          ]}
        />
      </div>

      {aba === 'redigir' &&
        (peca ? (
          <EditorPeca
            peca={peca}
            onNova={() => setPeca(null)}
            onAtualizada={p => {
              setPeca(atual => ({ ...paraEditavel(p), intervencoes: atual?.intervencoes ?? [], semJulgados: atual?.semJulgados }));
              setVersaoHistorico(v => v + 1);
            }}
            onDuplicada={p => abrir(paraEditavel(p))}
            onExcluida={() => {
              setPeca(null);
              setVersaoHistorico(v => v + 1);
            }}
          />
        ) : (
          <>
            <NovaPeca
              semAcesso={semAcesso}
              onGerada={abrir}
              onPedirPro={() => setModalPro(true)}
              onRestrito={m => setRestritoApi(m)}
            />
            {semAcesso && <ExemploMinuta />}
          </>
        ))}

      {aba === 'historico' &&
        (semAcesso ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <FileText size={26} className="mx-auto text-white/35" />
            <p className="mb-0 mt-3 text-sm font-medium text-white/75">O histórico de minutas faz parte do Plano Pro.</p>
          </div>
        ) : (
          <HistoricoPecas recarregar={versaoHistorico} onAbrir={p => abrir(paraEditavel(p))} />
        ))}

      <UpgradeProModal
        opened={modalPro}
        onClose={() => setModalPro(false)}
        motivo="Os modelos de peças jurídicas com IA (contestação, réplica, apelação, agravo, embargos e mais), com jurisprudência real e histórico, são um recurso exclusivo do Plano Pro."
      />
    </>
  );
}

/** Prévia ilustrativa para quem está no plano gratuito: mostra o formato do resultado sem gerar nada. */
function ExemploMinuta() {
  return (
    <section className="bf-paper mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6" aria-label="Exemplo de resultado">
      <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold text-white">
        <Scale size={17} className="text-[#1E7CF2]" /> Como fica a minuta
      </h2>
      <p className="mb-0 mt-1 text-xs text-white/50">Exemplo ilustrativo, sem dados reais. A minuta sai em seções editáveis, com aviso fixo e campos a preencher onde faltar informação.</p>
      <div className="mt-4 select-none rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/70">
        <p className="m-0 text-xs font-semibold text-amber-200">Minuta gerada por IA. Revise integralmente antes de protocolar; a responsabilidade técnica é do advogado.</p>
        <p className="mb-0 mt-3 text-xs font-semibold uppercase tracking-wide text-[#1E7CF2]">Endereçamento</p>
        <p className="m-0">Excelentíssimo Senhor Doutor Juiz de Direito da [PREENCHER: vara e comarca]</p>
        <p className="mb-0 mt-3 text-xs font-semibold uppercase tracking-wide text-[#1E7CF2]">Mérito</p>
        <p className="m-0">A parte ré impugna especificadamente os fatos narrados na inicial, pelas razões a seguir...</p>
        <p className="mb-0 mt-3 text-xs font-semibold uppercase tracking-wide text-[#1E7CF2]">Fecho</p>
        <p className="m-0">[PREENCHER: local e data] · [PREENCHER: nome do advogado e OAB]</p>
      </div>
    </section>
  );
}
