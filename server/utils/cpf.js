// Validação de CPF (algoritmo padrão dos dois dígitos verificadores).
// Não confirma que a pessoa existe — só que o número é matematicamente válido.
function somenteDigitos(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function calcularDigito(base) {
  let soma = 0;
  let peso = base.length + 1;
  for (const digito of base) {
    soma += parseInt(digito, 10) * peso;
    peso--;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function validarCPF(cpfBruto) {
  const cpf = somenteDigitos(cpfBruto);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 000.000.000-00, 111.111.111-11 etc.

  const digito1 = calcularDigito(cpf.slice(0, 9));
  if (digito1 !== parseInt(cpf[9], 10)) return false;
  const digito2 = calcularDigito(cpf.slice(0, 10));
  if (digito2 !== parseInt(cpf[10], 10)) return false;

  return true;
}

function formatarCPF(cpfBruto) {
  const cpf = somenteDigitos(cpfBruto);
  if (cpf.length !== 11) return cpfBruto || '';
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

module.exports = { validarCPF, formatarCPF, somenteDigitos };
