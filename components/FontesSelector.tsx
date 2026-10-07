'use client';

import React from 'react';
import { Select, SegmentedControl, Switch, TextInput } from '@mantine/core';
import { Check, ChevronRight, Info, Plus, Scale, Search, X } from 'lucide-react';
import type { CnjInfo } from '@/lib/cnj';
import { FONTES_DATAJUD, GRUPOS_FONTES, type GrupoFonte } from '@/lib/fontesDatajud';
import { FONTES_INFOSIMPLES, fontesInfosimplesPara, type FonteInfosimples, type TipoBusca } from '@/lib/fontesInfosimples';
import { custoServico, custoTotal, formatarReais } from '@/lib/infosimplesPricing';
import { UFS, UFS_RAPIDAS, nomeDaUf, ufsDoAlias } from '@/lib/regioes';

/* ── Tokens (mesma paleta dark/glass do ProcessTracker) ───────────────── */
const BLUE = '#c4a86f';
const BLUE_LIGHT = '#f5e3a8';
const BORDER = 'rgba(255,255,255,0.12)';
const INPUT_BORDER = 'rgba(255,255,255,0.18)';
const TEXT = '#f5f6fa';
const MUTED = 'rgba(226,229,245,0.65)';
const GREEN = '#8fb99a';

export const IDS_TODOS_DATAJUD = FONTES_DATAJUD.map(f => f.id);

/** Serviços Infosimples do tribunal de um número CNJ (os que aceitam busca por número). */
export function fontesInfosimplesDoTribunal(aliasDatajud: string) {
  return FONTES_INFOSIMPLES.filter(f => f.params.numero && aliasDatajud && f.datajud === aliasDatajud);
}

/** Custo estimado das fontes Infosimples marcadas que aceitam o tipo de busca. */
export function custoFontesSelecionadas(tipo: TipoBusca, selecionadas: string[]): number {
  const ids = new Set(selecionadas);
  return custoTotal(fontesInfosimplesPara(tipo).filter(f => ids.has(f.id)).map(f => f.service));
}

/** Agrupamento por região (não por ramo de Justiça) usado no Passo 2 da busca por CPF/CNPJ/nome. */
const REGIAO_POR_ALIAS: Record<string, string> = {
  tjsp: 'São Paulo',
  tjrj: 'Rio de Janeiro',
  tjmg: 'MG, PR e SC',
  tjpr: 'MG, PR e SC',
  tjsc: 'MG, PR e SC'
};

/** Rótulo de região de uma fonte Infosimples: estado mapeado acima, TRFs viram "Federal", o resto agrupa por grupo de Justiça. */
function regiaoDaFonte(f: FonteInfosimples): string {
  if (f.datajud && REGIAO_POR_ALIAS[f.datajud]) return REGIAO_POR_ALIAS[f.datajud];
  if (f.datajud?.startsWith('trf')) return 'Federal';
  return f.grupo;
}

/** Ordem de exibição das regiões na tela "Personalizar" (as 4 do mockup primeiro, demais depois). */
const ORDEM_REGIOES = ['São Paulo', 'Rio de Janeiro', 'MG, PR e SC', 'Federal'];

function compararRegiao(a: string, b: string): number {
  const ia = ORDEM_REGIOES.indexOf(a);
  const ib = ORDEM_REGIOES.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

interface FontesSelectorProps {
  tipoBusca: TipoBusca;
  /** Tribunal identificado a partir do número CNJ (busca por número). */
  detectado: CnjInfo | null;
  infosimplesSel: string[];
  onInfosimplesChange: (ids: string[]) => void;
  datajudSel: string[];
  onDatajudChange: (ids: string[]) => void;
}

export default function FontesSelector(props: FontesSelectorProps) {
  return props.tipoBusca === 'numero' ? <FontesPorNumero {...props} /> : <FontesPorDocumento {...props} />;
}

/* ── Busca por número: o tribunal vem do CNJ; escolhe-se o DataJud e os serviços Infosimples dele ── */
function FontesPorNumero({ detectado, infosimplesSel, onInfosimplesChange, datajudSel, onDatajudChange }: FontesSelectorProps) {
  const alias = detectado?.datajudAlias ?? '';
  const servicos = fontesInfosimplesDoTribunal(alias);
  const selInfo = new Set(infosimplesSel);

  if (!detectado?.valido) {
    return <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Informe um número CNJ válido no Passo 1 para ver as fontes disponíveis.</p>;
  }

  const alternar = (id: string, marcar: boolean) => {
    const next = new Set(infosimplesSel);
    if (marcar) next.add(id);
    else next.delete(id);
    onInfosimplesChange([...next]);
  };
  const usaDatajud = !!alias && datajudSel.includes(alias);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...cardStyle(true), display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Scale size={14} color={BLUE_LIGHT} />
        <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>
          {detectado.tribunalLabel} — {detectado.tribunalNome}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>identificado pelo número CNJ</span>
      </div>

      <FonteLinha
        titulo="DataJud (CNJ)"
        descricao={alias ? 'Base oficial do Conselho Nacional de Justiça.' : 'Este tribunal não possui endpoint no DataJud.'}
        preco={<span style={{ color: GREEN }}>Grátis</span>}
        checked={usaDatajud}
        disabled={!alias}
        onChange={v => onDatajudChange(v ? [...new Set([...datajudSel, alias])] : datajudSel.filter(a => a !== alias))}
      />

      <section style={cardStyle(false)}>
        <CabecalhoSecao
          titulo={'Infosimples — ' + detectado.tribunalLabel}
          selo="consulta paga"
          resumo={
            servicos.length > 0
              ? 'Consulta direta no portal do tribunal. Com mais de um sistema marcado, eles são consultados em sequência até achar o processo.'
              : 'A Infosimples não tem serviço de busca por número para este tribunal.'
          }
        />
        {servicos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {servicos.map(f => (
              <ItemFonte
                key={f.id}
                rotulo={f.id}
                dica={f.nome}
                preco={formatarReais(custoServico(f.service))}
                checked={selInfo.has(f.id)}
                onChange={v => alternar(f.id, v)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Busca por CPF/CNPJ/nome: seleção por grupo de justiça, com filtros ─────── */
interface Filtro {
  busca: string;
  uf: string | null;
  grupo: GrupoFonte | null;
}

const FILTRO_VAZIO: Filtro = { busca: '', uf: null, grupo: null };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Dados de uma fonte usados só para filtrar (UFs e texto de busca). */
function infoFiltro(label: string, nome: string, grupo: GrupoFonte, alias: string) {
  const ufs = ufsDoAlias(alias);
  const texto = semAcento([label, nome, grupo, ...ufs, ...ufs.map(nomeDaUf)].join(' '));
  return { ufs, texto };
}

function passaFiltro(f: Filtro, info: { ufs: string[]; texto: string }, grupo: GrupoFonte): boolean {
  if (f.uf && !info.ufs.includes(f.uf)) return false;
  if (f.grupo && grupo !== f.grupo) return false;
  const q = semAcento(f.busca.trim());
  return !q || info.texto.includes(q);
}

type ModoFontes = 'recomendado' | 'todas' | 'personalizar';

function FontesPorDocumento({ tipoBusca, infosimplesSel, onInfosimplesChange, datajudSel, onDatajudChange }: FontesSelectorProps) {
  const [filtro, setFiltro] = React.useState<Filtro>(FILTRO_VAZIO);
  // Modo inicial reflete a seleção já recebida: só assume "recomendado" às cegas se bater com o preset das principais.
  const [modo, setModo] = React.useState<ModoFontes>(() => {
    const compat = fontesInfosimplesPara(tipoBusca);
    const sel = new Set(infosimplesSel);
    const principais = compat.filter(f => f.principal).map(f => f.id);
    const bateComPrincipais = principais.length === sel.size && principais.every(id => sel.has(id));
    if (bateComPrincipais) return 'recomendado';
    const bateComTodas = compat.length === sel.size && compat.every(f => sel.has(f.id));
    if (bateComTodas) return 'todas';
    return 'personalizar';
  });
  const filtrando = !!(filtro.busca.trim() || filtro.uf || filtro.grupo);

  const compativeis = fontesInfosimplesPara(tipoBusca);
  const ocultas = FONTES_INFOSIMPLES.length - compativeis.length;
  const selInfo = new Set(infosimplesSel);
  const selDj = new Set(datajudSel);
  const rotuloTipo = tipoBusca === 'cnpj' ? 'CNPJ' : tipoBusca === 'nome' ? 'nome da parte' : 'CPF';

  // Fontes que passam pelos filtros (sem filtro ativo, todas).
  const infoVisiveis = compativeis.filter(f => passaFiltro(filtro, infoFiltro(f.id, f.nome, f.grupo, f.datajud ?? ''), f.grupo));
  const djVisiveis = FONTES_DATAJUD.filter(f => passaFiltro(filtro, infoFiltro(f.label, f.nome, f.grupo, f.id), f.grupo));

  const marcarInfo = (ids: string[], marcar: boolean) => {
    const next = new Set(infosimplesSel);
    ids.forEach(id => (marcar ? next.add(id) : next.delete(id)));
    onInfosimplesChange([...next]);
  };
  const marcarDj = (ids: string[], marcar: boolean) => {
    const next = new Set(datajudSel);
    ids.forEach(id => (marcar ? next.add(id) : next.delete(id)));
    onDatajudChange([...next]);
  };
  // Presets: substituem só a seleção das fontes compatíveis com o tipo de busca atual (as demais,
  // marcadas em outro tipo de busca, ficam como estão).
  const definirCompativeis = (marcados: string[]) => {
    const ids = new Set(compativeis.map(f => f.id));
    onInfosimplesChange([...infosimplesSel.filter(id => !ids.has(id)), ...marcados]);
  };

  const trocarModo = (novo: ModoFontes) => {
    setModo(novo);
    if (novo === 'recomendado') definirCompativeis(compativeis.filter(f => f.principal).map(f => f.id));
    else if (novo === 'todas') definirCompativeis(compativeis.map(f => f.id));
  };

  const custo = custoFontesSelecionadas(tipoBusca, infosimplesSel);
  const qtdInfo = compativeis.filter(f => selInfo.has(f.id)).length;
  const custoVisiveis = custoTotal(infoVisiveis.map(f => f.service));
  const idsInfoVisiveis = infoVisiveis.map(f => f.id);
  // Cobertura real: o DataJud não busca por CPF/CNPJ/nome, então o alcance da busca é o das fontes Infosimples marcadas.
  const selecionadas = compativeis.filter(f => selInfo.has(f.id));
  const ufsEstaduais = [...new Set(selecionadas.filter(f => f.grupo === 'Justiça Estadual').flatMap(f => ufsDoAlias(f.datajud ?? '')))];
  const idsDjVisiveis = djVisiveis.map(f => f.id);

  // Agrupamento por região (São Paulo / Rio de Janeiro / MG, PR e SC / Federal / outros), em vez de por ramo de Justiça.
  const regioesInfo = [...new Set(infoVisiveis.map(regiaoDaFonte))].sort(compararRegiao);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div role="note" style={{ ...cardStyle(true), display: 'flex', gap: 10, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>
        <Info size={16} style={{ flexShrink: 0, color: BLUE_LIGHT, marginTop: 2 }} />
        <div>
          <strong>Esta busca consulta {selecionadas.length} serviço{selecionadas.length === 1 ? '' : 's'} da Infosimples.</strong>{' '}
          Tribunais de Justiça cobertos: {ufsEstaduais.length > 0 ? ufsEstaduais.join(', ') : 'nenhum'}. Para os outros{' '}
          {UFS.length - ufsEstaduais.length} estados não existe consulta por {rotuloTipo}; se o processo estiver em um deles, use a
          busca por número do processo, em que o DataJud cobre todos os tribunais, de graça.
        </div>
      </div>

      {/* Infosimples */}
      <section style={cardStyle(false)}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 14, color: TEXT, fontWeight: 700 }}>Onde procurar?</span>
            <span style={{ fontSize: 11, color: BLUE_LIGHT, letterSpacing: 0.5, textTransform: 'uppercase' }}>consulta paga</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, margin: '2px 0 10px' }}>
            {qtdInfo} de {compativeis.length} fontes marcadas · {formatarReais(custo)}
          </div>
          <SegmentedControl
            fullWidth
            value={modo}
            onChange={v => trocarModo(v as ModoFontes)}
            data={[
              { label: 'Recomendado', value: 'recomendado' },
              { label: 'Todas', value: 'todas' },
              { label: 'Personalizar', value: 'personalizar' }
            ]}
          />
        </div>

        {modo === 'personalizar' && (
          <>
            <BarraFiltros filtro={filtro} onChange={setFiltro} />
            <div style={{ height: 12 }} />
            {regioesInfo.map(regiao => {
              const itens = infoVisiveis.filter(f => regiaoDaFonte(f) === regiao);
              const ids = itens.map(f => f.id);
              return (
                <GrupoRegiao
                  key={regiao}
                  titulo={regiao}
                  total={itens.length}
                  marcados={itens.filter(f => selInfo.has(f.id)).length}
                  onMarcarTodas={() => marcarInfo(ids, true)}
                >
                  {itens.map(f => (
                    <ChipFonte
                      key={f.id}
                      rotulo={f.id}
                      dica={f.nome}
                      preco={formatarReais(custoServico(f.service))}
                      checked={selInfo.has(f.id)}
                      onChange={v => marcarInfo([f.id], v)}
                    />
                  ))}
                </GrupoRegiao>
              );
            })}
            {filtrando && (
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <Preset destaque onClick={() => marcarInfo(idsInfoVisiveis, true)}>
                  Marcar filtradas ({infoVisiveis.length}) · {formatarReais(custoVisiveis)}
                </Preset>
                <Preset destaque onClick={() => marcarInfo(idsInfoVisiveis, false)}>
                  Desmarcar filtradas
                </Preset>
              </div>
            )}
            {infoVisiveis.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Nenhuma fonte Infosimples corresponde aos filtros.</p>
            )}
            {ocultas > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: MUTED }}>
                {ocultas} fonte{ocultas > 1 ? 's' : ''} não aceita{ocultas > 1 ? 'm' : ''} busca por {rotuloTipo} e não aparece{ocultas > 1 ? 'm' : ''} aqui.
              </p>
            )}
          </>
        )}
      </section>

      {/* DataJud */}
      <section style={cardStyle(false)}>
        <CabecalhoSecao
          titulo="DataJud (CNJ)"
          selo="gratuito"
          resumo={`${datajudSel.length} de ${FONTES_DATAJUD.length} endpoints marcados para complementar resultados · R$ 0,00`}
        >
          <Preset onClick={() => onDatajudChange(IDS_TODOS_DATAJUD)}>Todos</Preset>
          <Preset onClick={() => onDatajudChange([])}>Nenhum</Preset>
          {filtrando && (
            <>
              <Preset destaque onClick={() => marcarDj(idsDjVisiveis, true)}>
                Marcar filtrados ({djVisiveis.length})
              </Preset>
              <Preset destaque onClick={() => marcarDj(idsDjVisiveis, false)}>
                Desmarcar filtrados
              </Preset>
            </>
          )}
        </CabecalhoSecao>
        <p style={{ margin: '0 0 8px', fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          O DataJud não pesquisa por CPF, CNPJ nem nome: ele só entra depois, para complementar os processos que a Infosimples
          já achou (movimentações, assuntos, órgão julgador e grau). Se a Infosimples não achar nada, ele não é consultado.
        </p>

        {GRUPOS_FONTES.map(grupo => {
          const itens = djVisiveis.filter(f => f.grupo === grupo);
          if (itens.length === 0) return null;
          const ids = itens.map(f => f.id);
          return (
            <GrupoLista
              key={grupo}
              titulo={grupo}
              total={itens.length}
              marcados={itens.filter(f => selDj.has(f.id)).length}
              custo={0}
              abertoPorPadrao={filtrando}
              onMarcar={() => marcarDj(ids, true)}
              onLimpar={() => marcarDj(ids, false)}
            >
              {itens.map(f => (
                <ItemFonte
                  key={f.id}
                  rotulo={f.label}
                  dica={f.nome}
                  preco="Grátis"
                  precoCor={GREEN}
                  checked={selDj.has(f.id)}
                  onChange={v => marcarDj([f.id], v)}
                />
              ))}
            </GrupoLista>
          );
        })}
        {djVisiveis.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Nenhum endpoint do DataJud corresponde aos filtros.</p>
        )}
      </section>
    </div>
  );
}

/** Filtros das fontes: texto livre, estado (atalhos + lista completa) e tipo de justiça. */
function BarraFiltros({ filtro, onChange }: { filtro: Filtro; onChange: (f: Filtro) => void }) {
  const ativo = !!(filtro.busca.trim() || filtro.uf || filtro.grupo);
  return (
    <section style={{ ...cardStyle(false), display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <TextInput
            value={filtro.busca}
            onChange={e => onChange({ ...filtro, busca: e.currentTarget.value })}
            placeholder="Buscar fonte: TJSP, eproc, trabalhista, Rio..."
            aria-label="Buscar fontes"
            leftSection={<Search size={14} />}
          />
        </div>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <Select
            value={filtro.uf}
            onChange={uf => onChange({ ...filtro, uf })}
            data={UFS.map(u => ({ value: u.sigla, label: `${u.sigla} — ${u.nome}` }))}
            placeholder="Todos os estados"
            aria-label="Filtrar por estado"
            searchable
            clearable
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>Estado</span>
        {UFS_RAPIDAS.map(uf => (
          <Chip key={uf} ativo={filtro.uf === uf} onClick={() => onChange({ ...filtro, uf: filtro.uf === uf ? null : uf })}>
            Tribunais {uf}
          </Chip>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>Justiça</span>
        {GRUPOS_FONTES.map(g => (
          <Chip key={g} ativo={filtro.grupo === g} onClick={() => onChange({ ...filtro, grupo: filtro.grupo === g ? null : g })}>
            {g.replace('Justiça ', '')}
          </Chip>
        ))}
        {ativo && (
          <button type="button" onClick={() => onChange(FILTRO_VAZIO)} style={{ ...linkBtn, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> limpar filtros
          </button>
        )}
      </div>
    </section>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      style={{
        padding: '5px 11px',
        borderRadius: 16,
        border: `1px solid ${ativo ? BLUE_LIGHT : INPUT_BORDER}`,
        background: ativo ? 'rgba(255,255,255,0.16)' : 'transparent',
        color: ativo ? '#ffffff' : MUTED,
        fontSize: 11.5,
        fontWeight: ativo ? 700 : 500,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}

/* ── Peças de interface ───────────────────────────────────────────────── */
function cardStyle(destaque: boolean): React.CSSProperties {
  return {
    padding: '14px 16px',
    borderRadius: 4,
    border: `1px solid ${destaque ? BLUE : INPUT_BORDER}`,
    background: destaque ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'
  };
}

function CabecalhoSecao({ titulo, selo, resumo, children }: { titulo: string; selo: string; resumo: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, color: TEXT, fontWeight: 700 }}>{titulo}</span>
        <span style={{ fontSize: 11, color: BLUE_LIGHT, letterSpacing: 0.5, textTransform: 'uppercase' }}>{selo}</span>
      </div>
      <div style={{ fontSize: 12, color: MUTED, margin: '2px 0 8px' }}>{resumo}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Preset({ onClick, destaque, children }: { onClick: () => unknown; destaque?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      style={{
        padding: '6px 12px',
        borderRadius: 16,
        border: `1px solid ${destaque ? BLUE_LIGHT : INPUT_BORDER}`,
        background: destaque ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: TEXT,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}

function GrupoLista({
  titulo,
  total,
  marcados,
  custo,
  abertoPorPadrao,
  onMarcar,
  onLimpar,
  children
}: {
  titulo: GrupoFonte;
  total: number;
  marcados: number;
  /** Custo (R$) das fontes marcadas do grupo. */
  custo: number;
  abertoPorPadrao: boolean;
  onMarcar: () => void;
  onLimpar: () => void;
  children: React.ReactNode;
}) {
  const acao = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return (
    <details className="bf-fontes-group" open={abertoPorPadrao} style={{ borderTop: `1px solid ${BORDER}`, padding: '8px 0' }}>
      <summary
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: TEXT, fontWeight: 600, flexWrap: 'wrap' }}
      >
        <ChevronRight className="bf-chevron" size={14} color={MUTED} />
        <span>{titulo}</span>
        <span style={{ color: MUTED, fontWeight: 400 }}>
          {marcados}/{total}
        </span>
        {marcados > 0 && (
          <span style={{ color: custo > 0 ? TEXT : GREEN, fontWeight: 400 }}>{custo > 0 ? formatarReais(custo) : 'Grátis'}</span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={acao(onMarcar)} style={linkBtn}>
          marcar todas
        </button>
        <button type="button" onClick={acao(onLimpar)} style={linkBtn}>
          limpar
        </button>
      </summary>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>{children}</div>
    </details>
  );
}

/** Cabeçalho "Título X/Y · marcar todas" + os chips do grupo, no layout de região (mockup "Onde procurar?"). */
function GrupoRegiao({
  titulo,
  total,
  marcados,
  onMarcarTodas,
  children
}: {
  titulo: string;
  total: number;
  marcados: number;
  onMarcarTodas: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 700 }}>{titulo}</span>
        <span style={{ fontSize: 11.5, color: MUTED }}>
          {marcados}/{total}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onMarcarTodas} style={linkBtn}>
          marcar todas
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  );
}

/** Pill clicável: dourado preenchido quando marcado, contorno neutro quando não — layout do mockup "Onde procurar?". */
function ChipFonte({
  rotulo,
  dica,
  preco,
  checked,
  onChange
}: {
  rotulo: string;
  dica: string;
  preco: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      title={dica}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 13px',
        borderRadius: 18,
        border: `1px solid ${checked ? BLUE : INPUT_BORDER}`,
        background: checked ? BLUE : 'transparent',
        color: checked ? '#1a1608' : TEXT,
        fontSize: 12,
        fontWeight: checked ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {checked ? <Check size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={2.5} />}
      <span>{rotulo}</span>
      <span style={{ opacity: checked ? 0.75 : 0.6 }}>{preco}</span>
    </button>
  );
}

const linkBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: BLUE_LIGHT, fontSize: 11.5, cursor: 'pointer', padding: 0 };

function ItemFonte({
  rotulo,
  dica,
  preco,
  precoCor,
  checked,
  onChange
}: {
  rotulo: string;
  dica: string;
  preco: string;
  precoCor?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Switch
      title={dica}
      label={
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
          <span>{rotulo}</span>
          <span style={{ color: precoCor ?? MUTED, fontWeight: 400 }}>{preco}</span>
        </span>
      }
      size="xs"
      color={BLUE}
      checked={checked}
      onChange={e => onChange(e.currentTarget.checked)}
      styles={{ label: { color: TEXT, fontSize: 12, flex: 1, cursor: 'pointer' }, body: { alignItems: 'center' }, track: { cursor: 'pointer' } }}
    />
  );
}

function FonteLinha({
  titulo,
  descricao,
  preco,
  checked,
  disabled,
  onChange
}: {
  titulo: string;
  descricao: string;
  preco: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ ...cardStyle(checked), opacity: disabled ? 0.55 : 1 }}>
      <Switch
        disabled={disabled}
        checked={checked}
        color={BLUE}
        onChange={e => onChange(e.currentTarget.checked)}
        label={
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{titulo}</span>
            <span style={{ fontSize: 12.5, color: MUTED }}>{preco}</span>
          </span>
        }
        styles={{ label: { flex: 1, cursor: disabled ? 'not-allowed' : 'pointer' }, body: { alignItems: 'center' }, track: { cursor: disabled ? 'not-allowed' : 'pointer' } }}
      />
      <p style={{ margin: '6px 0 0 44px', fontSize: 12, color: MUTED }}>{descricao}</p>
    </div>
  );
}
