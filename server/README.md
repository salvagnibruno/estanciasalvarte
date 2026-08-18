# Estância Salvarte — Vitrine e Marketplace

Site completo (frontend + backend + banco de dados) da loja **Estância Salvarte**: vitrine de produtos,
carrinho, checkout com Mercado Pago, encomendas/avisos de estoque, agenda de serviços, painel admin e
painel superadmin com relatórios.

## Stack usada

- **Backend:** Node.js + Express
- **Banco de dados:** SQLite (arquivo `db/estancia.db`), acessado via `better-sqlite3`. Todos os dados
  ficam em **tabelas relacionais** (produtos, categorias, usuários, pedidos, carrinho, agendamentos,
  encomendas, histórico de preços, eventos de analytics) — nada é salvo em JSON solto.
- **Frontend:** HTML + CSS + JavaScript puro (sem build step), servido como arquivos estáticos pelo
  próprio Express a partir de `public/`.
- **Pagamentos:** SDK oficial `mercadopago` (Checkout Pro — cartão de crédito, débito e Pix, tudo
  processado na conta Mercado Pago da loja).

## Como rodar localmente

```bash
cd server
npm install
cp .env.example .env
# edite o .env se quiser trocar a senha inicial do superadmin ou configurar o Mercado Pago
npm start
```

O site sobe em `http://localhost:3000`. Na primeira execução o banco é criado automaticamente
(`db/estancia.db`), populado com as categorias e ~42 produtos extraídos do catálogo, e o usuário
**superadmin** é criado com o e-mail `bruno.salvagni@gmail.com`.

A senha inicial do superadmin aparece no console na primeira execução (ou é a definida em
`SUPERADMIN_SENHA_INICIAL` no `.env`). **Troque essa senha assim que possível** (ainda não há tela de
"alterar minha senha" — se quiser, posso adicionar).

## Perfis de acesso

| Perfil | Acesso |
|---|---|
| **Cliente** | Navega, compra, agenda serviços — login opcional (permite salvar carrinho, pedidos e interesses) |
| **Admin** | Painel `/admin/index.html`: cadastra/edita/inativa/exclui produtos, gerencia estoque, pedidos, agendamentos e encomendas. **Não vê o custo do produto e não pode alterar o preço de venda.** |
| **Superadmin** | Painel `/superadmin/index.html`: tudo do admin + custo do produto, definição/recalculo de preço, liberação de novos usuários admin, cadastro de cupons, configurações do site (contato/logo/avisos) e relatórios/gráficos gerenciais |

O superadmin (`bruno.salvagni@gmail.com`) é fixo no código (`db/db.js`) — sempre que o banco for
recriado do zero, essa conta é recriada automaticamente.

## Cadastro de cliente e login

O cadastro público (tela "Criar conta") exige confirmação por e-mail no primeiro acesso:

1. Cliente preenche nome, e-mail, senha e telefone → a conta é criada, mas **inativa até confirmar**.
2. Um código de 6 dígitos é enviado por e-mail (ver seção "E-mail" abaixo). Sem SMTP configurado, o
   código aparece no console/log do servidor — útil para testar sem precisar configurar nada.
3. Cliente digita o código na mesma tela → a conta é confirmada e o login acontece automaticamente.

Contas criadas pelo superadmin (usuários admin) e o superadmin de bootstrap **não passam por essa
confirmação** — só o autocadastro público exige.

O login em si sempre exige e-mail e senha exatos (comparação de hash, sem tolerância) — isso já valia
antes e continua valendo, com a confirmação de e-mail como uma camada extra para contas novas.

## E-mail (código de confirmação de cadastro)

Configurado via SMTP em `server/.env` (veja `.env.example` para o passo a passo com Gmail). Sem essas
variáveis, o código de confirmação só aparece no console do servidor — o cadastro continua funcionando
para testes, só não chega e-mail de verdade ao cliente.

## Checkout: dados para nota fiscal

Login continua opcional para comprar. Mas **em toda compra** (com ou sem login), o checkout agora exige:
nome, e-mail, telefone, CPF e endereço residencial completo (CEP, logradouro, número, bairro, cidade,
UF). O endereço de entrega é o mesmo do residencial por padrão — o cliente só digita um segundo endereço
se marcar que a entrega é em outro lugar. Tudo isso fica gravado no pedido (visível no painel, seção
"Pedidos") para emissão da nota fiscal.

## Cupons

Cadastro exclusivo do **superadmin** (painel > Cupons). Cada cupom tem:

- **Código** (o que o cliente digita no checkout).
- **Produtos aplicáveis**: nenhum selecionado = vale para o carrinho inteiro; um, vários ou "aplicar a
  todos" restringem o desconto ao subtotal só daqueles produtos.
- **Percentual ou valor fixo** de desconto.
- **Validade por período** (data inicial e/ou final) **e/ou por quantidade de usos** (ex.: 5 = só vale
  nos 5 primeiros pedidos que o utilizarem) — as duas regras podem ser combinadas; o cupom vale enquanto
  todas as que forem preenchidas ainda permitirem.

## Configurações do site (painel superadmin > Site)

- **Contato e redes sociais**: telefone, WhatsApp, Instagram e e-mail exibidos no cabeçalho/rodapé do
  site público — editáveis sem mexer em código (antes ficavam fixos em `loja.js`).
- **Logomarca**: upload de uma nova imagem substitui a logo em todo o site e no catálogo em PDF.
- **Avisos**: banners com título, mensagem e janela de exibição (data inicial/final opcionais) exibidos
  no topo do site enquanto estiverem dentro do período e ativos. Cadastro, edição e exclusão pelo
  superadmin.

## Funil por produto (relatórios)

O relatório "Funil por produto — visualizações → carrinho → venda" conta só o que acontece **a partir do
momento em que o site foi publicado** (marca gravada em `configuracoes.funil_reset_em`, feita uma única
vez). Pedidos, produtos e os demais relatórios (faturamento, mais vendidos, etc.) continuam com o
histórico completo — só esse funil específico começa zerado, para não misturar dado de teste/desenvolvimento
com o comportamento real dos clientes.

## Regra de precificação

Definida em `db/pricing.js` — aplicada automaticamente sempre que o superadmin cadastra/atualiza o
**custo** de um produto:

- custo até R$ 50,00 → markup de 55%
- custo de R$ 50,01 a R$ 80,00 → markup de 50%
- custo de R$ 80,01 a R$ 120,00 → markup de 45%
- custo acima de R$ 120,00 → markup de 40%

O superadmin também pode fixar um **preço manual** (ignora a regra) quando quiser.

## Custos de produto: de onde vieram

Os produtos do catálogo (`Catalogo_Rancho_Salvagni.pdf`) foram cruzados com as tabelas de custo do
fornecedor que você enviou. Todo produto tem um campo `custo_fonte`:

- **`tabela`** — o custo veio diretamente de uma das tabelas de preço enviadas.
- **`estimado`** — não havia custo exato para aquela variação específica (ex.: alguns itens infantis e
  toda a linha de uniformes/jalecos), então foi estimado com base em itens equivalentes. Esses ficam
  marcados no painel superadmin (coluna "Custo") para você revisar e corrigir quando tiver o valor real —
  o preço de venda recalcula automaticamente assim que você salvar o novo custo.

## Mercado Pago

Sem configurar nada, o checkout ainda funciona: o pedido é registrado com a opção "combinar pagamento"
(você fecha com o cliente por WhatsApp/telefone). Para ativar o pagamento online de verdade:

1. Acesse o [painel de desenvolvedores do Mercado Pago](https://www.mercadopago.com.br/developers/panel)
   com a conta da loja e gere um **Access Token de produção**.
2. Coloque esse token em `MERCADOPAGO_ACCESS_TOKEN` no `.env`.
3. Reinicie o servidor. A partir daí, ao escolher cartão de crédito, débito ou Pix no checkout, o cliente
   é redirecionado para o Checkout Pro do Mercado Pago, e o webhook (`/api/pagamento/webhook`) atualiza o
   pedido automaticamente para "pago" e dá baixa no estoque.

Em produção, o Mercado Pago precisa conseguir alcançar `SEU_DOMINIO/api/pagamento/webhook` pela internet
— então isso só funciona depois de hospedado (não funciona com `localhost`).

## Estrutura de pastas

```
server/
  server.js            servidor Express principal
  db/
    schema.sql         estrutura das tabelas
    seed.js            categorias + produtos do catálogo (roda só se o banco estiver vazio)
    pricing.js          regra de markup
    db.js              abre o banco, roda schema.sql + seed, cria o superadmin
  middleware/auth.js    checagem de login/papel
  middleware/upload.js  upload de imagens (produtos e logomarca do site)
  utils/                e-mail (código de confirmação), validação de CPF, configurações do site
  routes/               API (auth, produtos, carrinho, pedidos, pagamento, agendamentos, encomendas,
                         interesses, gestão admin, superadmin, cupons)
  public/               todo o site (html/css/js), + /admin e /superadmin (painéis)
```

## Onde hospedar de graça

Como o site guarda tudo em um arquivo SQLite (`db/estancia.db`), o ponto principal na hora de escolher
hospedagem gratuita é: **o disco precisa ser persistente** (não pode apagar o arquivo a cada deploy/reinício).

**Atualização (2026):** o cenário de hospedagem gratuita mudou bastante nos últimos anos — hoje **não
existe mais** uma opção que seja ao mesmo tempo grátis para sempre, sem pedir cartão e com disco
persistente. Fly.io, por exemplo, encerrou o plano gratuito para contas novas (hoje pede cartão desde o
cadastro). As opções realistas em 2026:

1. **App em host gratuito (sem disco persistente) + banco gerenciado à parte** — ex.: Render.com free
   (web service Node gratuito, sem cartão) + **Turso** (SQLite compatível na nuvem, plano gratuito sem
   cartão, com console web para consultar/editar dados — atende ao "acesso ao banco para manutenção").
   Exige trocar `better-sqlite3` por `@libsql/client` nas queries (mudança de código: chamadas passam a
   ser assíncronas). É o caminho que preserva o SQL quase idêntico ao que já existe.
2. **App em host gratuito + Postgres gerenciado** — Render.com free (app) + **Supabase** ou **Neon**
   (Postgres gratuito, sem cartão, com editor de tabelas/SQL pela web). Exige uma migração maior (sintaxe
   SQL do Postgres é diferente da do SQLite em vários pontos).
3. **VPS com disco persistente de verdade** — ex. Oracle Cloud "Always Free" (máquina pequena grátis
   permanente, mas pede cartão para verificar identidade no cadastro, sem cobrança dentro do limite
   gratuito). Roda o código exatamente como está, sem nenhuma mudança — é o único caminho que não exige
   tocar no banco de dados.
4. **Hospedagem paga de baixo custo** (Railway, Render pago, VPS barata) — sem as pegadinhas de card/roteiro
   acima, com um custo mensal pequeno.

Cada caminho tem um trade-off diferente (cartão exigido vs. quantidade de código a mudar vs. custo) — vale
decidir junto antes de seguir com a publicação.

**Importante:** antes de apontar o domínio final, faça uma cópia de segurança do arquivo
`server/db/estancia.db` (ele já tem todo o catálogo, preços e o usuário superadmin cadastrados). Bastando
copiar esse arquivo para a pasta `db/` do servidor novo, todo o cadastro que você já fez continua exatamente
como está — nenhuma informação se perde na migração. Numa base vazia, o catálogo de produtos também é
recriado automaticamente pelo `seed.js` — mas qualquer ajuste manual feito depois pelo painel (fotos,
preços, destaques) só existe no arquivo `estancia.db` atual, por isso a cópia é importante.

## Próximos passos sugeridos

- Preencher WhatsApp/Instagram/e-mail reais no rodapé (`public/js/layout.js`) e na página "Quem somos".
- A logomarca oficial está em `public/img/logo-oficial.jpg` e o caminho é declarado em `loja.js` — trocar
  ali muda o site inteiro e o catálogo em PDF de uma vez (o catálogo lê o arquivo e o embute na folha).
- Revisar no painel superadmin os produtos marcados como custo **"estimado"** e lançar o custo real assim
  que tiver a tabela definitiva do fornecedor para uniformes/jalecos e algumas peças infantis.
- Adicionar fotos reais dos produtos (campo "URL da imagem" no cadastro/edição de produto).
