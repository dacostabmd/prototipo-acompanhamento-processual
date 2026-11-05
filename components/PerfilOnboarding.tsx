'use client';

import { useState } from 'react';
import { Modal } from '@mantine/core';
import AbasDeslizantes, { ConteudoDeslizante, useDirecaoAba } from './AbasDeslizantes';
import { Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { cleanDigits, formatDocumento, isValidCnpj, isValidCpf } from '@/lib/format';
import { useSharedProfile } from './ProfileProvider';

type Escolha = 'advogado' | 'broker' | 'cliente';

const ESCOLHAS: { label: string; value: Escolha }[] = [
  { label: 'Advogado', value: 'advogado' },
  { label: 'Broker', value: 'broker' },
  { label: 'Consulta Avulsa', value: 'cliente' }
];

const DESCRICAO: Record<Escolha, string> = {
  advogado: 'Acesso a consultas livres por qualquer CPF ou CNJ, gestão de carteiras e automações.',
  broker: 'Acesso a consultas livres, análise de precatórios/ativos judiciais e automação de funil.',
  cliente: 'Acesso restrito ao próprio CPF/CNPJ cadastrado, ideal para acompanhamento pessoal.'
};

/**
 * Pergunta o perfil de acesso depois do primeiro login (o cadastro só pede nome, e-mail e senha).
 * Aparece enquanto a conta é "cliente" sem documento fixado: é o estado que o trigger ap_handle_new_user
 * cria quando o cadastro não informa perfil, e a única transição que o banco aceita do próprio usuário
 * (cliente sem documento -> advogado/broker, ou fixar o documento mantendo cliente).
 */
export default function PerfilOnboarding() {
  const { profile, loading, refresh } = useSharedProfile();
  const [escolha, setEscolha] = useState<Escolha>('advogado');
  const [documento, setDocumento] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const direcao = useDirecaoAba(escolha, ESCOLHAS.map(e => e.value));

  const supabase = getSupabase();
  const pendente = !!supabase && !loading && profile.role === 'cliente' && !profile.documento;
  if (!pendente) return null;

  const digitos = cleanDigits(documento);
  const documentoValido = digitos.length === 11 ? isValidCpf(digitos) : digitos.length === 14 ? isValidCnpj(digitos) : false;

  const salvar = async () => {
    setErro('');
    if (escolha === 'cliente' && !documentoValido) return setErro('Informe um CPF ou CNPJ válido para a Consulta Avulsa.');
    setSalvando(true);
    try {
      const { data } = await supabase!.auth.getUser();
      if (!data.user) return setErro('Sessão expirada. Entre novamente.');
      const alteracao =
        escolha === 'cliente'
          ? { documento: digitos, documento_tipo: digitos.length === 14 ? 'cnpj' : 'cpf' }
          : { role: escolha };
      const { error } = await supabase!.from('ap_perfis').update(alteracao).eq('id', data.user.id);
      if (error) return setErro('Não foi possível salvar agora. Tente novamente.');
      await refresh();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      title="Qual é o seu perfil de acesso?"
    >
      <p style={{ fontSize: 14, margin: '0 0 16px', opacity: 0.75 }}>Leva só um instante e personaliza o seu acesso.</p>
      <AbasDeslizantes fullWidth ariaLabel="Perfil de acesso" value={escolha} onChange={setEscolha} data={ESCOLHAS} />

      <ConteudoDeslizante chave={escolha} direcao={direcao}>
      <p style={{ fontSize: 12, margin: '8px 0 0', lineHeight: 1.4, opacity: 0.75 }}>{DESCRICAO[escolha]}</p>

      {escolha === 'cliente' && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="bf-onb-documento" style={{ display: 'block', fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>
            CPF ou CNPJ do titular
          </label>
          <input
            id="bf-onb-documento"
            className="bf-input"
            placeholder="000.000.000-00"
            value={documento}
            maxLength={18}
            onChange={e => setDocumento(formatDocumento(e.target.value))}
            autoComplete="off"
          />
          <p style={{ fontSize: 12, margin: '6px 0 0', opacity: 0.75 }}>
            Você consultará os processos ligados a este documento fixo. Depois de salvo, ele não pode ser alterado.
          </p>
        </div>
      )}
      </ConteudoDeslizante>

      {erro && (
        <div role="alert" style={{ marginTop: 14, color: '#f3b4bd', border: '1px solid rgba(180,82,95,0.4)', padding: '10px 12px', borderRadius: 12, fontSize: 14 }}>
          {erro}
        </div>
      )}

      <button type="button" onClick={salvar} disabled={salvando} className="bf-btn-primary bf-btn-ouro" style={{ marginTop: 18, width: '100%', cursor: 'pointer' }}>
        {salvando ? <Loader2 size={16} className="animate-spin" /> : <span>Continuar</span>}
      </button>
    </Modal>
  );
}
