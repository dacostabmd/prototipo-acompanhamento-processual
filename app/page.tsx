import AuthGateway from '@/components/AuthGateway';
import NavbarPublica from '@/components/NavbarPublica';

export default function Home() {
  return (
    <>
      <NavbarPublica />
      <AuthGateway variante="busca" />
    </>
  );
}
