import { MapPin } from 'lucide-react';

/**
 * Rodapé de todas as telas: marca JusConsulta ao lado da TechTie, assinatura e endereço. Sempre azul-noite
 * (igual à sidebar), nos dois modos. Vai no layout raiz e, dentro do app autenticado, no AppShell.Main —
 * a cópia da raiz some quando o shell está na tela (ver .bf-rodape--raiz em app/globals.css).
 */
export default function RodapeGlobal({ raiz = false }: { raiz?: boolean }) {
  return (
    <footer className={raiz ? 'bf-rodape bf-rodape--raiz' : 'bf-rodape'}>
      <div className="bf-rodape-inner">
        <div className="bf-rodape-marcas">
          <span className="bf-rodape-jus">
            <img src="/jusconsulta-mark.svg" alt="" width={24} height={27} />
            <span className="bf-rodape-wordmark">
              <strong>Jus</strong>
              <span>Consulta</span>
            </span>
          </span>
          <span className="bf-rodape-divisor" aria-hidden />
          <span className="bf-rodape-jus">
            <img src="/techtie-mark-512.png" alt="" width={28} height={28} className="bf-rodape-techtie" />
            <span className="bf-rodape-wordmark">TechTie</span>
          </span>
        </div>

        <p className="bf-rodape-assinatura">Uma solução TechTie, uma solução jurídica.</p>

        <div className="bf-rodape-info">
          <span className="bf-rodape-endereco">
            <MapPin size={14} strokeWidth={1.8} />
            Av. das Américas, 3443 · Rio de Janeiro, RJ
          </span>
          <span>© {new Date().getFullYear()} TechTie. Todos os direitos reservados.</span>
        </div>
      </div>
    </footer>
  );
}
