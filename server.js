/**
 * Servidor Autônomo para Confraternização seppen - Polícia Penal RJ
 * Executa nativamente no Node.js (sem necessidade de npm install).
 * 
 * Funcionalidades:
 * 1. Servir a página web (index.html e cartaz)
 * 2. Gerar Pix dinâmico via API oficial do Mercado Pago
 * 3. Receber Webhook de confirmação instantânea
 * 4. Salvar participantes aprovados na planilha CSV automaticamente
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || ''; // Token do Mercado Pago do Alexandre
const CSV_FILE = path.join(__dirname, 'planilha_controle_evento_seppen.csv');
const WHATSAPP_GROUP_URL = process.env.WHATSAPP_GROUP_URL || 'https://chat.whatsapp.com/convite-seppen-2026';

// Memória temporária de transações
const transacoes = new Map();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function salvarNaPlanilha(dados) {
  const linha = `\n${Date.now()},${new Date().toISOString().replace('T', ' ').substring(0, 19)},"${dados.nome}","${dados.matricula || ''}","${dados.lotacao || ''}","${dados.whatsapp}","${dados.cpf || ''}","${dados.opcao === '200' ? 'À Vista' : 'Parcelado 2x'}",${dados.opcao === '200' ? '200.00' : '200.00'},${dados.opcao === '200' ? '200.00' : '100.00'},"${dados.opcao === '200' ? 'Integral' : '1ª Parcela'}",${dados.opcao === '200' ? '0.00' : '100.00'},"${dados.opcao === '200' ? 'QUITADO' : 'PARCELA 1 PAGA'}","${dados.paymentId || 'MP-PIX'}",Sim,Pendente,"Inscrição automática via sistema"`;
  fs.appendFileSync(CSV_FILE, linha, 'utf8');
  console.log(`[PLANILHA] Participante adicionado à planilha: ${dados.nome}`);
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. CRIAR PIX DINÂMICO MERCADO PAGO
  if (pathname === '/api/criar-pix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { nome, whatsapp, matricula, lotacao, opcao, cpf } = JSON.parse(body);
        const valor = parseFloat(opcao) || 200.00;
        const externalId = `seppen-${Date.now()}`;

        // Se o token estiver configurado, chama a API real do Mercado Pago
        if (MP_ACCESS_TOKEN) {
          const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': externalId
            },
            body: JSON.stringify({
              transaction_amount: valor,
              description: `Confraternização seppen - ${opcao === '200' ? 'À Vista' : '1ª Parcela'}`,
              payment_method_id: 'pix',
              payer: {
                email: 'ppsantosalexandre78@gmail.com', // ou email do participante se fornecido
                first_name: nome.split(' ')[0],
                last_name: nome.split(' ').slice(1).join(' ') || 'Polícia Penal'
              }
            })
          });

          const mpData = await mpResponse.json();
          const pointOfInteraction = mpData.point_of_interaction?.transaction_data;

          if (pointOfInteraction) {
            transacoes.set(String(mpData.id), {
              nome, whatsapp, matricula, lotacao, opcao, cpf,
              status: 'pending',
              paymentId: mpData.id
            });

            return sendJson(res, 200, {
              success: true,
              paymentId: mpData.id,
              pixCopiaCola: pointOfInteraction.qr_code,
              qrCodeBase64: pointOfInteraction.qr_code_base64,
              valor: valor
            });
          }
        }

        // Modo Simulado Inteligente (para testes locais sem Token)
        const fakeId = `SIM-${Date.now()}`;
        const fakePix = `00020126580014br.gov.bcb.pix0131ppsantosalexandre78@gmail.com520400005303986540${valor.toFixed(2)}5802BR5925ALEXANDRE DA SILVA SANTOS6009RIO DE JANEIRO62070503***6304${Math.floor(1000 + Math.random() * 9000)}`;

        transacoes.set(fakeId, {
          nome, whatsapp, matricula, lotacao, opcao, cpf,
          status: 'pending',
          paymentId: fakeId
        });

        return sendJson(res, 200, {
          success: true,
          paymentId: fakeId,
          pixCopiaCola: fakePix,
          qrCodeBase64: null,
          valor: valor
        });

      } catch (err) {
        console.error('[ERRO CRIAR PIX]', err);
        return sendJson(res, 500, { error: 'Falha ao processar solicitação.' });
      }
    });
    return;
  }

  // 2. CONSULTAR STATUS DA TRANSAÇÃO (POLLING DO FRONTEND)
  if (pathname.startsWith('/api/status/') && req.method === 'GET') {
    const id = pathname.replace('/api/status/', '');
    const tx = transacoes.get(id);

    if (!tx) {
      return sendJson(res, 404, { error: 'Transação não encontrada' });
    }

    return sendJson(res, 200, {
      status: tx.status,
      groupUrl: tx.status === 'approved' ? WHATSAPP_GROUP_URL : null
    });
  }

  // 3. WEBHOOK MERCADO PAGO OU CONFIRMAÇÃO MANUAL
  if (pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const paymentId = payload.data?.id || payload.paymentId;

        if (paymentId && transacoes.has(String(paymentId))) {
          const tx = transacoes.get(String(paymentId));
          tx.status = 'approved';
          salvarNaPlanilha(tx);
        }

        return sendJson(res, 200, { received: true });
      } catch (e) {
        return sendJson(res, 200, { received: false });
      }
    });
    return;
  }

  // 4. SERVIR ARQUIVOS ESTÁTICOS (HTML, IMAGENS)
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.csv': 'text/csv'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Página não encontrada.');
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Sistema seppen Confraternização rodando na porta ${PORT}`);
  console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
  console.log(`📊 Planilha conectada: ${CSV_FILE}`);
  console.log(`=======================================================`);
});
