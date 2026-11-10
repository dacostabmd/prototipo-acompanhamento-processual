'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, MultiSelect, type ComboboxItem, type ComboboxParsedItem, type OptionsFilter } from '@mantine/core';
import { ArrowRight, Check, Coins, Crown, Landmark, Search, Zap } from 'lucide-react';
import { useSharedProfile } from '@/components/ProfileProvider';
import { useDevVisaoAdvogado } from '@/lib/devVisao';
import { cleanDigits, formatDocumento, isValidCnpj, isValidCpf } from '@/lib/format';
import { fontesInfosimplesPara, type FonteInfosimples, type TipoBusca } from '@/lib/fontesInfosimples';
import { GRUPOS_FONTES } from '@/lib/fontesDatajud';
import { custoTotal, formatarReais } from '@/lib/infosimplesPricing';
import { nomeDaUf, ufsDoAlias } from '@/lib/regioes';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texto pesquisável de uma fonte: id, nome, grupo, UFs (sigla e nome) e sinônimos da Justiça do Trabalho. */
function textoDaFonte(f: FonteInfosimples): string {
  const ufs = ufsDoAlias(f.datajud ?? '');
  const sinonimos = f.grupo === 'Justiça do Trabalho' ? 'trabalhista trabalho ceat certidao' : '';
  return semAcento([f.id, f.nome, f.grupo, sinonimos, ...ufs, ...ufs.map(nomeDaUf)].join(' '));
}

interface Props {
  opened: boolean;
  onClose: () => void;
}

/**
 * Busca rápida da Visão geral: só o CPF/CNPJ e os tribunais em que a consulta deve rodar. Ao continuar, leva para
 * /consulta com o documento e as fontes já marcadas (a tela de busca pede a confirmação do custo antes de pesquisar).
 */
export default function BuscaRapidaModal({ opened, onClose }: Props) {
  const router = useRouter();
  const { profile } = useSharedProfile();
  const devVisaoAdvogado = useDevVisaoAdvogado();
  const isConsultante = profile.role === 'cliente';
  const contaPro = profile.plano === 'pro' || profile.role === 'admin' || profile.role === 'owner';
  // Mesma regra da tela de busca: documento é da visão de advogado/Pro; o consultante só busca o próprio documento.
  const liberado = devVisaoAdvogado || contaPro || isConsultante;

  const [docDigitado, setDocDigitado] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const digitos = cleanDigits(isConsultante ? profile.documento ?? '' : docDigitado);
  const docValido = (digitos.length === 11 && isValidCpf(digitos)) || (digitos.length === 14 && isValidCnpj(digitos));
  const tipo: TipoBusca = digitos.length === 14 ? 'cnpj' : 'cpf';

  const compativeis = useMemo(() => fontesInfosimplesPara(tipo), [tipo]);
  const idsCompativeis = useMemo(() => new Set(compativeis.map(f => f.id)), [compativeis]);
  const textos = useMemo(() => new Map(compativeis.map(f => [f.id, textoDaFonte(f)])), [compativeis]);
  const nomes = useMemo(() => new Map(compativeis.map(f => [f.id, f.nome])), [compativeis]);

  // Trocar de CPF para CNPJ pode tirar fontes da lista: só valem as que aceitam o tipo atual.
  const efetivos = selecionados.filter(id => idsCompativeis.has(id));
  const custo = custoTotal(compativeis.filter(f => efetivos.includes(f.id)).map(f => f.service));

  const dados = useMemo(
    () =>
      GRUPOS_FONTES.map(grupo => ({
        group: grupo,
        items: compativeis.filter(f => f.grupo === grupo).map(f => ({ value: f.id, label: f.id }))
      })).filter(g => g.items.length > 0),
    [compativeis]
  );

  const filtrar: OptionsFilter = ({ options, search }) => {
    const q = semAcento(search.trim());
    if (!q) return options;
    const casa = (i: ComboboxItem) => (textos.get(i.value) ?? '').includes(q);
    return options.flatMap<ComboboxParsedItem>(o => {
      if ('group' in o) {
        const items = o.items.filter(casa);
        return items.length > 0 ? [{ ...o, items }] : [];
      }
      return casa(o) ? [o] : [];
    });
  };

  const marcarGrupo = (grupo: string) => setSelecionados(compativeis.filter(f => f.grupo === grupo).map(f => f.id));

  const pronto = liberado && docValido && efetivos.length > 0;

  const continuar = () => {
    if (!pronto) return;
    const params = new URLSearchParams({ busca: digitos, fontes: efetivos.join('|') });
    onClose();
    router.push(`/consulta?${params.toString()}`);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      size="lg"
      title={
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <Zap size={18} className="text-[#1E7CF2]" />
          Busca rápida por CPF ou CNPJ
        </span>
      }
    >
      {!liberado ? (
        <div className="rounded-2xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 p-4 text-sm text-white/80">
          <p className="m-0 inline-flex items-start gap-2">
            <Crown size={17} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
            A busca por CPF ou CNPJ em tribunais específicos é um recurso do Plano Pro.
          </p>
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push('/planos');
            }}
            className="bf-btn-ouro mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Conhecer o Plano Pro
            <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={e => {
            e.preventDefault();
            continuar();
          }}
          className="flex flex-col gap-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/60">CPF ou CNPJ</span>
            <input
              value={isConsultante ? formatDocumento(digitos) : docDigitado}
              onChange={e => setDocDigitado(formatDocumento(e.target.value))}
              disabled={isConsultante}
              inputMode="numeric"
              maxLength={18}
              placeholder="000.000.000-00"
              autoFocus={!isConsultante}
              aria-invalid={digitos.length >= 11 && !docValido}
              className="h-11 w-full rounded-lg border border-tt-line bg-tt-surface px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#1E7CF2] disabled:cursor-not-allowed disabled:opacity-60"
            />
            {digitos.length >= 11 && !docValido && (
              <span className="mt-1 block text-xs text-red-300">
                {digitos.length === 11 || digitos.length === 14 ? 'Documento inválido: confira os dígitos.' : 'Informe 11 dígitos (CPF) ou 14 (CNPJ).'}
              </span>
            )}
          </label>

          <div>
            <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
              <span>Tribunais</span>
              <span className="font-normal normal-case tracking-normal text-white/45">
                {efetivos.length} de {compativeis.length} marcados
              </span>
            </span>
            <MultiSelect
              aria-label="Tribunais"
              data={dados}
              value={efetivos}
              onChange={setSelecionados}
              filter={filtrar}
              searchable
              clearable
              hidePickedOptions={false}
              nothingFoundMessage="Nenhum tribunal encontrado"
              placeholder={efetivos.length === 0 ? 'Busque por tribunal, estado ou "trabalhista"' : ''}
              maxDropdownHeight={300}
              comboboxProps={{ withinPortal: true }}
              styles={{ input: { maxHeight: 150, overflowY: 'auto' }, option: { cursor: 'pointer' } }}
              renderOption={({ option, checked }) => (
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="block truncate text-xs opacity-60">{nomes.get(option.value)}</span>
                  </span>
                  {checked && <Check size={14} className="shrink-0 text-[#1E7CF2]" />}
                </span>
              )}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <AtalhoTribunais onClick={() => setSelecionados(compativeis.filter(f => f.principal).map(f => f.id))}>Principais</AtalhoTribunais>
              <AtalhoTribunais onClick={() => marcarGrupo('Justiça do Trabalho')}>Trabalhistas</AtalhoTribunais>
              <AtalhoTribunais onClick={() => marcarGrupo('Justiça Estadual')}>Estaduais</AtalhoTribunais>
              <AtalhoTribunais onClick={() => marcarGrupo('Justiça Federal')}>Federais</AtalhoTribunais>
              <AtalhoTribunais onClick={() => setSelecionados(compativeis.map(f => f.id))}>Todos</AtalhoTribunais>
              {efetivos.length > 0 && (
                <button type="button" onClick={() => setSelecionados([])} className="ml-auto cursor-pointer text-xs text-white/50 hover:text-white/80">
                  Limpar
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/[0.07] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm text-white/70">
              <Coins size={16} className="text-[#1E7CF2]" />
              Custo previsto
            </span>
            <span className="text-base font-bold text-white">{efetivos.length > 0 ? `até ${formatarReais(custo)}` : 'Escolha os tribunais'}</span>
          </div>

          <p className="m-0 flex items-start gap-2 text-xs text-white/50">
            <Landmark size={14} className="mt-px shrink-0" />
            Na próxima tela você confirma o custo antes de pesquisar. Todos os tribunais marcados são consultados, sem a economia por estado.
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="bf-btn-sec cursor-pointer rounded-xl px-4 py-2 text-sm">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!pronto}
              className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search size={15} />
              Continuar para a busca
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AtalhoTribunais({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-full border border-white/20 bg-transparent px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:border-[#1E7CF2] hover:text-white"
    >
      {children}
    </button>
  );
}
