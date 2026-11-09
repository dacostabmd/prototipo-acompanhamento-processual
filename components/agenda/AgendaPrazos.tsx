'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  AlarmClock,
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCheck,
  Crown,
  Download,
  FileDown,
  Loader2,
  SearchCheck
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import AbasDeslizantes, { ConteudoDeslizante } from '@/components/AbasDeslizantes';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import { PrazoCard } from './PrazoCard';
import { NovoPrazoModal } from './NovoPrazoModal';
import { SugestoesModal } from './SugestoesModal';
import type { PrazoAgenda, SugestaoPrazo } from './agendaUtil';

type Aba = 'atrasados' | 'hoje' | 'proximos' | 'concluidos';
const ORDEM_ABAS: readonly Aba[] = ['atrasados', 'hoje', 'proximos', 'concluidos'];

const VAZIO: Record<Aba, { icone: typeof CalendarCheck; titulo: string; texto: string }> = {
  atrasados: { icone: CheckCheck, titulo: 'Nada atrasado', texto: 'Você está em dia com todos os prazos pendentes.' },
  hoje: { icone: CalendarCheck, titulo: 'Nada vence hoje', texto: 'Nenhum prazo ou tarefa com vencimento para hoje.' },
  proximos: { icone: CalendarDays, titulo: 'Nenhum compromisso futuro', texto: 'Crie um prazo ou busque nas suas movimentações.' },
  concluidos: { icone: CalendarCheck, titulo: 'Nada concluído ainda', texto: 'Os compromissos que você concluir aparecem aqui.' }
};

export function AgendaPrazos() {
  const [prazos, setPrazos] = useState<PrazoAgenda[]>([]);
  const [hoje, setHoje] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const [carregando, setCarregando] = useState(true);
  const [bloqueado, setBloqueado] = useState(false);
  const [aba, setAba] = useState<Aba>('hoje');
  const [abaEscolhida, setAbaEscolhida] = useState(false);

  const [modalNovo, setModalNovo] = useState(false);
  const [editando, setEditando] = useState<PrazoAgenda | null>(null);
  const [modalPro, setModalPro] = useState(false);

  const [modalSugestoes, setModalSugestoes] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoPrazo[] | null>(null);
  const [importando, setImportando] = useState(false);
  const [exportandoIcs, setExportandoIcs] = useState(false);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const res = await authFetch('/api/agenda?filtro=todos');
      const dados = await res.json().catch(() => ({}));
      if (res.status === 403 && dados.codigo === 'recurso_pro') {
        setBloqueado(true);
        return;
      }
      if (!res.ok) throw new Error(dados.error || 'Falha ao carregar a agenda.');
      setBloqueado(false);
      setPrazos(dados.prazos ?? []);
      if (dados.hoje) setHoje(dados.hoje);
    } catch (err) {
      notifications.show({ title: 'Agenda indisponível', message: err instanceof Error ? err.message : 'Tente novamente em instantes.', color: 'red' });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const grupos = useMemo(() => {
    const pendentes = prazos.filter(p => !p.concluido).sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
    return {
      atrasados: pendentes.filter(p => p.dataVencimento < hoje),
      hoje: pendentes.filter(p => p.dataVencimento === hoje),
      proximos: pendentes.filter(p => p.dataVencimento > hoje),
      concluidos: prazos.filter(p => p.concluido).sort((a, b) => (b.concluidoEm ?? '').localeCompare(a.concluidoEm ?? ''))
    } satisfies Record<Aba, PrazoAgenda[]>;
  }, [prazos, hoje]);

  // Na primeira carga, abre na aba que mais precisa de atenção.
  useEffect(() => {
    if (carregando || abaEscolhida) return;
    setAba(grupos.atrasados.length ? 'atrasados' : grupos.hoje.length ? 'hoje' : 'proximos');
  }, [carregando, abaEscolhida, grupos]);

  const marcar = (id: string, ligado: boolean) =>
    setOcupados(atual => {
      const novo = new Set(atual);
      if (ligado) novo.add(id);
      else novo.delete(id);
      return novo;
    });

  const alternarConcluido = async (prazo: PrazoAgenda) => {
    const concluido = !prazo.concluido;
    marcar(prazo.id, true);
    setPrazos(lista => lista.map(p => (p.id === prazo.id ? { ...p, concluido, concluidoEm: concluido ? new Date().toISOString() : null } : p)));
    try {
      const res = await authFetch('/api/agenda', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prazo.id, concluido })
      });
      if (!res.ok) throw new Error();
    } catch {
      setPrazos(lista => lista.map(p => (p.id === prazo.id ? prazo : p)));
      notifications.show({ title: 'Erro ao atualizar', message: 'Não foi possível alterar o prazo agora.', color: 'red' });
    } finally {
      marcar(prazo.id, false);
    }
  };

  const excluir = async (prazo: PrazoAgenda) => {
    if (!confirm(`Excluir "${prazo.titulo}" da agenda?`)) return;
    try {
      const res = await authFetch(`/api/agenda?id=${encodeURIComponent(prazo.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setPrazos(lista => lista.filter(p => p.id !== prazo.id));
      notifications.show({ title: 'Removido', message: 'O compromisso saiu da agenda.', color: 'brand' });
    } catch {
      notifications.show({ title: 'Erro ao excluir', message: 'Não foi possível remover agora.', color: 'red' });
    }
  };

  const abrirNovo = () => {
    setEditando(null);
    setModalNovo(true);
  };

  const buscarNasMovimentacoes = async () => {
    setSugestoes(null);
    setModalSugestoes(true);
    try {
      const res = await authFetch('/api/agenda/sugestoes');
      const dados = await res.json().catch(() => ({}));
      if (res.status === 403 && dados.codigo === 'recurso_pro') {
        setModalSugestoes(false);
        setModalPro(true);
        return;
      }
      if (!res.ok) throw new Error(dados.error || 'Falha ao varrer as movimentações.');
      setSugestoes(dados.sugestoes ?? []);
    } catch (err) {
      setModalSugestoes(false);
      notifications.show({ title: 'Busca indisponível', message: err instanceof Error ? err.message : 'Tente novamente em instantes.', color: 'red' });
    }
  };

  const importarSugestoes = async (escolhidas: SugestaoPrazo[]) => {
    setImportando(true);
    try {
      const res = await authFetch('/api/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: escolhidas.map(s => ({
            titulo: s.titulo,
            descricao: s.descricao,
            dataVencimento: s.dataVencimento,
            tipo: 'prazo',
            numeroCnj: s.numeroCnj,
            origemHash: s.origemHash
          }))
        })
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.error || 'Não foi possível criar os prazos.');
      notifications.show({ title: 'Prazos adicionados', message: `${dados.criados ?? 0} prazo(s) criado(s). Confira as datas no processo.`, color: 'brand' });
      setModalSugestoes(false);
      await carregar();
    } catch (err) {
      notifications.show({ title: 'Falha ao adicionar', message: err instanceof Error ? err.message : 'Tente novamente.', color: 'red' });
    } finally {
      setImportando(false);
    }
  };

  const exportarIcs = async () => {
    setExportandoIcs(true);
    try {
      const res = await authFetch('/api/agenda/ics');
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jusconsulta-agenda-${hoje}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      notifications.show({ title: 'Erro ao exportar', message: 'Não foi possível gerar o calendário agora.', color: 'red' });
    } finally {
      setExportandoIcs(false);
    }
  };

  const exportarPdf = () => window.open('/agenda/imprimir?auto=1', '_blank', 'noopener');

  const Vazio = VAZIO[aba];
  const lista = grupos[aba];
  const semNada = prazos.length === 0;

  const botoes = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={abrirNovo}
        className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold"
      >
        <CalendarPlus size={16} />
        Novo prazo/tarefa
      </button>
      <button type="button" onClick={buscarNasMovimentacoes} className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm">
        <SearchCheck size={16} />
        Buscar prazos nas minhas movimentações
      </button>
      <button
        type="button"
        onClick={exportarIcs}
        disabled={exportandoIcs || semNada}
        className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {exportandoIcs ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        Exportar calendário (.ics)
      </button>
      <button
        type="button"
        onClick={exportarPdf}
        disabled={semNada}
        className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FileDown size={16} />
        Exportar PDF
      </button>
    </div>
  );

  if (bloqueado) {
    return (
      <>
        <PreviaPlanoFree onUpgrade={() => setModalPro(true)} />
        <UpgradeProModal
          opened={modalPro}
          onClose={() => setModalPro(false)}
          motivo="A agenda de prazos e tarefas com lembretes por WhatsApp e e-mail é um recurso exclusivo do Plano Pro."
          onSucesso={() => {
            setCarregando(true);
            carregar();
          }}
        />
      </>
    );
  }

  return (
    <>
      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-md sm:p-6">
        <div className="flex flex-col gap-4">
          {botoes}

          <AbasDeslizantes<Aba>
            rolavel
            fullWidth
            ariaLabel="Filtrar compromissos"
            value={aba}
            onChange={v => {
              setAbaEscolhida(true);
              setAba(v);
            }}
            data={[
              { value: 'atrasados', label: <RotuloAba icone={AlertTriangle} texto="Atrasados" total={grupos.atrasados.length} /> },
              { value: 'hoje', label: <RotuloAba icone={AlarmClock} texto="Hoje" total={grupos.hoje.length} /> },
              { value: 'proximos', label: <RotuloAba icone={CalendarClock} texto="Próximos" total={grupos.proximos.length} /> },
              { value: 'concluidos', label: <RotuloAba icone={CheckCheck} texto="Concluídos" total={grupos.concluidos.length} /> }
            ]}
          />
        </div>

        <div className="mt-5">
          {carregando ? (
            <p className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 size={16} className="animate-spin text-[#1E7CF2]" />
              Carregando agenda...
            </p>
          ) : (
            <ConteudoDeslizante chave={aba} ordem={ORDEM_ABAS}>
              {lista.length === 0 ? (
                <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-8 text-center">
                  <Vazio.icone size={26} className="mx-auto text-white/30" />
                  <p className="mb-0 mt-2 text-sm font-medium text-white/70">{Vazio.titulo}</p>
                  <p className="mb-0 mt-0.5 text-xs text-white/40">{Vazio.texto}</p>
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {lista.map(p => (
                    <PrazoCard
                      key={p.id}
                      prazo={p}
                      hoje={hoje}
                      ocupado={ocupados.has(p.id)}
                      onAlternarConcluido={alternarConcluido}
                      onEditar={prazo => {
                        setEditando(prazo);
                        setModalNovo(true);
                      }}
                      onExcluir={excluir}
                    />
                  ))}
                </div>
              )}
            </ConteudoDeslizante>
          )}
        </div>
      </section>

      <NovoPrazoModal
        opened={modalNovo}
        onClose={() => setModalNovo(false)}
        editando={editando}
        hoje={hoje}
        onSalvo={carregar}
        onRecursoPro={() => setModalPro(true)}
      />
      <SugestoesModal opened={modalSugestoes} onClose={() => setModalSugestoes(false)} sugestoes={sugestoes} importando={importando} onImportar={importarSugestoes} />
      <UpgradeProModal
        opened={modalPro}
        onClose={() => setModalPro(false)}
        motivo="A agenda de prazos e tarefas com lembretes por WhatsApp e e-mail é um recurso exclusivo do Plano Pro."
      />
    </>
  );
}

function RotuloAba({ icone: Icone, texto, total }: { icone: typeof CalendarClock; texto: string; total: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icone size={14} aria-hidden />
      {texto}
      {total > 0 && <span className="text-[11px] opacity-80">({total})</span>}
    </span>
  );
}

/** Conta Free: prévia desfocada da agenda com chamada para o Plano Pro. */
function PreviaPlanoFree({ onUpgrade }: { onUpgrade: () => void }) {
  const exemplos = [
    { titulo: 'Contestação', quando: 'vence em 3 dias', cor: 'border-amber-300/30 bg-amber-300/[0.06]' },
    { titulo: 'Audiência de instrução', quando: 'vence em 8 dias', cor: 'border-white/10 bg-white/[0.03]' },
    { titulo: 'Manifestar sobre laudo pericial', quando: 'vence em 12 dias', cor: 'border-white/10 bg-white/[0.03]' }
  ];
  return (
    <section className="bf-paper relative min-h-[24rem] overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm sm:p-6">
      <div aria-hidden className="pointer-events-none grid select-none gap-2.5 opacity-60 blur-[3px]">
        {exemplos.map(e => (
          <div key={e.titulo} className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${e.cor}`}>
            <span className="text-sm font-semibold text-white">{e.titulo}</span>
            <span className="text-xs font-semibold text-white/60">{e.quando}</span>
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-white/10 bg-[color:var(--tt-surface)] p-5 text-center shadow-xl">
          <Crown size={26} className="mx-auto text-[#1E7CF2]" />
          <h2 className="mb-0 mt-2 text-lg font-semibold text-white">Agenda de prazos é do Plano Pro</h2>
          <p className="mb-0 mt-1.5 text-sm text-white/60">
            Cadastre prazos e tarefas, receba lembretes por WhatsApp e e-mail, deixe o sistema achar prazos nas intimações e exporte para o seu calendário.
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="bf-btn-ouro mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
          >
            <Crown size={15} />
            Conhecer o Plano Pro
          </button>
        </div>
      </div>
    </section>
  );
}
