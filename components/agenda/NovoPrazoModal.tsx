'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { CalendarPlus, CalendarClock, ClipboardList, Gavel, Loader2, Save } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { formatProcessNumber } from '@/lib/cnj';
import AbasDeslizantes from '@/components/AbasDeslizantes';
import type { PrazoAgenda, TipoPrazo } from './agendaUtil';

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Prazo em edição; null para criar um novo. */
  editando: PrazoAgenda | null;
  /** Data de hoje (Brasília), usada como padrão do vencimento. */
  hoje: string;
  onSalvo: () => void;
  onRecursoPro: () => void;
}

const CLASSE_CAMPO =
  'mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60';

export function NovoPrazoModal({ opened, onClose, editando, hoje, onSalvo, onRecursoPro }: Props) {
  const [tipo, setTipo] = useState<TipoPrazo>('prazo');
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState(hoje);
  const [cnj, setCnj] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Reinicia o formulário a cada abertura (com os dados do prazo, quando for edição).
  useEffect(() => {
    if (!opened) return;
    setTipo(editando?.tipo ?? 'prazo');
    setTitulo(editando?.titulo ?? '');
    setData(editando?.dataVencimento ?? hoje);
    setCnj(editando?.numeroCnj ?? '');
    setDescricao(editando?.descricao ?? '');
  }, [opened, editando, hoje]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      notifications.show({ title: 'Informe o título', message: 'Descreva o prazo ou a tarefa.', color: 'red' });
      return;
    }
    if (!data) {
      notifications.show({ title: 'Informe a data', message: 'Escolha a data de vencimento.', color: 'red' });
      return;
    }

    setSalvando(true);
    try {
      const corpo = { titulo, dataVencimento: data, tipo, descricao, numeroCnj: cnj.trim() || null };
      const res = await authFetch('/api/agenda', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editando ? { id: editando.id, ...corpo } : corpo)
      });
      const resposta = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (resposta.codigo === 'recurso_pro') {
          onClose();
          onRecursoPro();
          return;
        }
        throw new Error(resposta.error || 'Não foi possível salvar.');
      }
      notifications.show({ title: editando ? 'Prazo atualizado' : 'Prazo criado', message: 'Os lembretes seguem a nova data.', color: 'brand' });
      onSalvo();
      onClose();
    } catch (err) {
      notifications.show({ title: 'Falha ao salvar', message: err instanceof Error ? err.message : 'Tente novamente em instantes.', color: 'red' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      size="md"
      title={
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <CalendarPlus size={18} className="text-[#1E7CF2]" />
          {editando ? 'Editar compromisso' : 'Novo prazo ou tarefa'}
        </span>
      }
    >
      <form onSubmit={salvar} className="grid gap-4">
        <div>
          <span className="block text-xs font-medium text-white/70">Tipo</span>
          <AbasDeslizantes<TipoPrazo>
            className="mt-1.5"
            fullWidth
            ariaLabel="Tipo de compromisso"
            value={tipo}
            onChange={setTipo}
            data={[
              { value: 'prazo', label: <span className="inline-flex items-center gap-1.5"><Gavel size={14} />Prazo</span> },
              { value: 'tarefa', label: <span className="inline-flex items-center gap-1.5"><ClipboardList size={14} />Tarefa</span> },
              { value: 'audiencia', label: <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} />Audiência</span> }
            ]}
          />
        </div>

        <div>
          <label htmlFor="agenda-titulo" className="block text-xs font-medium text-white/70">
            Título
          </label>
          <input
            id="agenda-titulo"
            type="text"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            maxLength={300}
            placeholder="Ex.: Contestação, juntar procuração, audiência de instrução"
            className={CLASSE_CAMPO}
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="agenda-data" className="block text-xs font-medium text-white/70">
              Vencimento
            </label>
            <input id="agenda-data" type="date" value={data} onChange={e => setData(e.target.value)} className={`${CLASSE_CAMPO} cursor-pointer`} required />
          </div>
          <div>
            <label htmlFor="agenda-cnj" className="block text-xs font-medium text-white/70">
              Processo (opcional)
            </label>
            <input
              id="agenda-cnj"
              type="text"
              inputMode="numeric"
              value={cnj}
              onChange={e => setCnj(formatProcessNumber(e.target.value))}
              maxLength={25}
              placeholder="0000000-00.0000.0.00.0000"
              className={`${CLASSE_CAMPO} font-mono`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="agenda-descricao" className="block text-xs font-medium text-white/70">
            Observações (opcional)
          </label>
          <textarea
            id="agenda-descricao"
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            maxLength={4000}
            rows={3}
            className={`${CLASSE_CAMPO} resize-y`}
          />
        </div>

        <p className="m-0 text-xs text-white/50">Você recebe lembretes 3 dias antes, 1 dia antes e no dia do vencimento, por WhatsApp e e-mail.</p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="bf-btn-sec cursor-pointer rounded-xl px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {editando ? 'Salvar alterações' : 'Criar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
