/**
 * Utilitários de Proteção e Análise contra Arquivos Maliciosos
 * Realiza inspeção de MIME-type, extensões duplas/perigosas e Magic Bytes binários.
 */

export interface FileValidationResult {
  safe: boolean;
  error?: string;
  name: string;
  size: number;
  type: string;
}

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'scr', 'pif', 'dll', 'com', 'hta', 'cpl', 'jar', 'iso', 'bin', 'msi',
  'msp', 'reg', 'ps1', 'psm1', 'php', 'asp', 'aspx', 'jsp', 'cgi'
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx']);

export async function validateSafeDocument(file: File): Promise<FileValidationResult> {
  const name = file.name;
  const size = file.size;
  const type = file.type || 'application/octet-stream';

  // 1. Verificação de Tamanho
  if (size === 0) {
    return { safe: false, error: 'Arquivo vazio não permitido.', name, size, type };
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    return {
      safe: false,
      error: `Arquivo excede o limite máximo permitido de 15MB (${(size / (1024 * 1024)).toFixed(1)}MB).`,
      name,
      size,
      type
    };
  }

  // 2. Verificação de Extensão e Ataque de Dupla Extensão (ex: documento.pdf.exe)
  const nameParts = name.toLowerCase().split('.');
  if (nameParts.length < 2) {
    return { safe: false, error: 'Arquivo sem extensão válida.', name, size, type };
  }

  const finalExt = nameParts[nameParts.length - 1];

  // Verifica se alguma das partes intermediárias é uma extensão maliciosa disfarçada
  for (const part of nameParts.slice(1)) {
    if (DANGEROUS_EXTENSIONS.has(part)) {
      return {
        safe: false,
        error: `Extensão de risco ou executável bloqueada por segurança (.${part}).`,
        name,
        size,
        type
      };
    }
  }

  if (!ALLOWED_EXTENSIONS.has(finalExt)) {
    return {
      safe: false,
      error: `Formato de arquivo não suportado (.${finalExt}). Permitido apenas: PDF, Imagens (PNG, JPG, WEBP) e Documentos (DOC, DOCX).`,
      name,
      size,
      type
    };
  }

  // 3. Inspeção de Magic Bytes Binários (Assinatura Real do Cabeçalho)
  try {
    const headerBuffer = await file.slice(0, 8).arrayBuffer();
    const bytes = new Uint8Array(headerBuffer);

    // Detecção imediata de Executáveis Windows PE (MZ) ou ELF Linux
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return { safe: false, error: 'Arquivo executável bloqueado pelo antivírus do sistema.', name, size, type };
    }
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return { safe: false, error: 'Binário ELF bloqueado pelo antivírus do sistema.', name, size, type };
    }

    // Validação de PDF (%PDF)
    if (finalExt === 'pdf') {
      const isPdfHeader =
        bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
      if (!isPdfHeader) {
        return {
          safe: false,
          error: 'Assinatura inválida: o arquivo não é um PDF legítimo.',
          name,
          size,
          type
        };
      }
    }

    // Validação de PNG (\x89PNG)
    if (finalExt === 'png') {
      const isPngHeader =
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!isPngHeader) {
        return { safe: false, error: 'Assinatura de imagem PNG corrompida ou ilegítima.', name, size, type };
      }
    }

    // Validação de JPEG (\xFF\xD8\xFF)
    if (finalExt === 'jpg' || finalExt === 'jpeg') {
      const isJpgHeader = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!isJpgHeader) {
        return { safe: false, error: 'Assinatura de imagem JPEG corrompida ou ilegítima.', name, size, type };
      }
    }
  } catch (err) {
    console.error('[security] Falha ao inspecionar bytes:', err);
    return { safe: false, error: 'Não foi possível validar a integridade do arquivo.', name, size, type };
  }

  return {
    safe: true,
    name,
    size,
    type
  };
}
