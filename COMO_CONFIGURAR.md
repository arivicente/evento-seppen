# Sistema Autônomo de Inscrição e Pagamento Pix - seppen 2026
### Confraternização de Fim de Ano | Polícia Penal do Estado do Rio de Janeiro

Este sistema resolve integralmente o gargalo operacional do organizador **Alexandre da Silva Santos**, eliminando a necessidade de conferir comprovantes manuais, digitar listas de presença no WhatsApp e adicionar convidados um a um.

---

## 📁 Arquivos Criados no Projeto

1. **[`index.html`](index.html)**: 
   - Página web completa, moderna e 100% responsiva (otimizada para celular).
   - Identidade visual com brasão e cores oficiais da Polícia Penal e Governo do Estado do RJ.
   - Painel interativo com botões de 1 clique para **Google Maps** e **Waze**.
   - Guia de chegada: Carro, Moto, Uber/Táxi, Metrô Jardim Oceânico e Ônibus Linha 557.
   - Formulário de inscrição do policial (Nome, WhatsApp, Matrícula, Lotação).
   - Seletor de pagamento: **À Vista R$ 200,00** ou **Parcelado 2x de R$ 100,00** (1ª parcela agora, 2ª até 10/12).
   - Gerador dinâmico de QR Code Pix e Pix Copia e Cola com cópia em 1 toque.
   - Redirecionamento instantâneo para o **Grupo Oficial do WhatsApp** assim que o Pix é pago.

2. **[`planilha_controle_evento_seppen.csv`](planilha_controle_evento_seppen.csv)**:
   - Planilha detalhada com todas as colunas de controle para a portaria e gestão financeira.
   - Pronta para ser aberta no Excel ou importada para o **Google Sheets**.

3. **[`server.js`](server.js)**:
   - Servidor Node.js nativo (sem precisar de `npm install`), que orquestra a geração de Pix direto na conta do Mercado Pago do Alexandre, escuta Webhooks bancários e salva os confirmados na planilha automaticamente.

4. **[`cartaz_evento.jpg`](cartaz_evento.jpg)**:
   - Imagem oficial do evento integrada diretamente na interface.

---

## 🗺️ Informações de Acesso e Logística (Clube Costa Brava)

* **Endereço Oficial:** Rua Sargento José da Silva, nº 3621 – Joá, Rio de Janeiro – RJ.
* **Complexo Residencial:** O clube fica no alto da falésia da Joatinga, dentro da **SAJO (Sociedade dos Amigos da Joatinga)**.

### 🚗 Como Chegar de Carro / Moto
* **Rotas:** Via Autoestrada Lagoa-Barra ou Estrada do Joá. Pegar a subida em direção à Praia da Joatinga.
* **Guarita da SAJO:** Informe na portaria que você está se dirigindo à **Confraternização da Polícia Penal no Clube Costa Brava**. A portaria libera a cancela.
* **Estacionamento:** O clube possui vagas internas reservadas aos convidados do evento.

### 🚕 De Uber / 99 / Táxi
* Colocar no app de transporte: **"Costa Brava Clube"**. Os motoristas têm permissão para acessar a guarita do condomínio e desembarcar os passageiros diretamente na entrada do clube.

### 🚌 De Transporte Público (Metrô + Ônibus)
* **Metrô:** Pegar a Linha 4 até a **Estação Jardim Oceânico** (Barra da Tijuca).
* **Conexão rápida:** Da estação Jardim Oceânico, o trajeto de Uber/táxi leva entre **5 e 8 minutos**.
* **Ônibus:** Linha **557** (Copacabana ⇄ Rio das Pedras / via Joá) ou linhas alimentadoras que passam na Av. Ministro Ivan Lins.

---

## 📊 Estrutura da Planilha de Controle

| Coluna | Descrição |
| :--- | :--- |
| **ID** | Código sequencial da inscrição |
| **Data_Inscricao** | Data e hora do registro |
| **Nome_Completo** | Nome completo do policial penal |
| **Matricula** | Matrícula funcional para conferência na portaria |
| **Lotacao_Unidade** | Unidade (ex: seppen, GSI, GIR, SEAP, Corregedoria) |
| **WhatsApp** | Número com DDD para envio de lembretes e avisos |
| **CPF** | Documento do titular |
| **Opcao_Pagamento** | À Vista (R$ 200) ou Parcelado 2x (R$ 100) |
| **Valor_Total** | R$ 200,00 |
| **Valor_Pago** | R$ 200,00 (quitado) ou R$ 100,00 (parcial) |
| **Parcela_Atual** | Integral ou 1ª Parcela |
| **Saldo_Devedor** | R$ 0,00 ou R$ 100,00 (a vencer em 10/12) |
| **Status_Pagamento** | `QUITADO` ou `PARCELA 1 PAGA` |
| **Chave_Transacao_Pix**| ID da transação bancária no Mercado Pago |
| **Entrou_Grupo_WhatsApp** | `Sim` / `Não` |
| **Presente_Checkin** | Campo para a recepção marcar na entrada do clube |
| **Observacoes** | Anotações adicionais |

---

## ⚡ Como Rodar o Sistema

### Opção 1: Abrir Diretamente no Navegador
Você pode simplesmente dar dois cliques no arquivo [`index.html`](index.html). Ele funciona imediatamente no computador ou celular.

### Opção 2: Rodar o Servidor Localmente
No terminal do Windows (PowerShell), dentro da pasta:
```powershell
node server.js
```
Acesse: `http://localhost:3000`

### Opção 3: Conectar a Conta Real do Mercado Pago do Alexandre
Para o dinheiro cair com webhook oficial na conta `ppsantosalexandre78@gmail.com`:
1. O Alexandre acessa [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers).
2. Cria uma credencial de aplicação ("Confraternização seppen").
3. Copia o **Access Token** de Produção e define como variável de ambiente:
```powershell
$env:MP_ACCESS_TOKEN="APP_USR-seu-token-aqui"
node server.js
```
Pronto! Toda cobrança gerada é registrada diretamente na conta bancária do Alexandre, com aprovação e baixa instantânea em 3 segundos.
