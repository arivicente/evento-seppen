/**
 * Cloudflare Worker - Sistema Autônomo Confraternização SEPPEN RJ 2026
 * 
 * Rotas da API:
 * - POST /api/criar-pix             -> Gera cobrança Pix na API Mercado Pago + salva pedido no KV
 * - POST /api/webhook/mercadopago   -> Recebe notificação, valida Zero Trust no MP, salva e dispara WhatsApp Meta
 * - GET  /api/status/:id            -> Polling do frontend (só libera o link do grupo quando status === 'approved')
 * - GET  /api/admin/export?key=...  -> Exporta lista de confirmados em CSV
 * - *                               -> Serve os arquivos estáticos de ./public
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function formatPhoneBR(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  return `55${digits}`;
}

async function sendMetaWhatsAppTemplate(toPhone, nome, env) {
  if (!env.META_WHATSAPP_TOKEN || !env.META_PHONE_NUMBER_ID || !env.WHATSAPP_GROUP_URL) {
    console.warn('[META_WA] Variáveis META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID ou WHATSAPP_GROUP_URL não configuradas.');
    return;
  }

  const templateName = env.WHATSAPP_TEMPLATE_NAME || 'confirmacao_evento_pix';
  const url = `https://graph.facebook.com/v21.0/${env.META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nome.split(' ')[0] },
            { type: 'text', text: env.WHATSAPP_GROUP_URL },
          ],
        },
      ],
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[META_WA] Falha ao enviar template:', resp.status, errText);
  } else {
    console.log(`[META_WA] Mensagem enviada com sucesso para ${toPhone}`);
  }
}

async function processMercadoPagoWebhook(paymentId, env) {
  if (!paymentId || !env.MP_ACCESS_TOKEN) return;

  // 1. Consulta Zero Trust na API do Mercado Pago
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });

  if (!mpRes.ok) {
    console.error('[MP_WEBHOOK] Erro ao consultar pagamento:', paymentId, mpRes.status);
    return;
  }

  const mpPayment = await mpRes.json();
  if (mpPayment.status !== 'approved') {
    console.log(`[MP_WEBHOOK] Pagamento ${paymentId} ainda com status: ${mpPayment.status}`);
    return;
  }

  // 2. Recupera o pedido no KV
  const kvKey = `order:${paymentId}`;
  let order = await env.SEPPEN_KV.get(kvKey, { type: 'json' });

  if (!order) {
    const meta = mpPayment.metadata || {};
    order = {
      paymentId: String(paymentId),
      nome: meta.nome || 'Policial Penal',
      whatsapp: meta.whatsapp || '',
      matricula: meta.matricula || '',
      lotacao: meta.lotacao || '',
      opcao: String(meta.opcao || mpPayment.transaction_amount),
      valor: mpPayment.transaction_amount,
      status: 'pending',
      whatsapp_enviado: false,
      createdAt: new Date().toISOString(),
    };
  }

  // 3. Trava de idempotência: evita envio duplicado de WhatsApp
  if (order.whatsapp_enviado) {
    console.log(`[MP_WEBHOOK] Pagamento ${paymentId} já processado anteriormente.`);
    return;
  }

  // 4. Atualiza status e salva no KV antes de disparar WhatsApp
  order.status = 'approved';
  order.whatsapp_enviado = true;
  order.approvedAt = new Date().toISOString();
  await env.SEPPEN_KV.put(kvKey, JSON.stringify(order));

  // Registra na lista de aprovados para exportação CSV
  const listKey = 'approved_ids';
  const existingList = (await env.SEPPEN_KV.get(listKey, { type: 'json' })) || [];
  if (!existingList.includes(String(paymentId))) {
    existingList.push(String(paymentId));
    await env.SEPPEN_KV.put(listKey, JSON.stringify(existingList));
  }

  // 5. Dispara confirmação via API Oficial da Meta
  if (order.whatsapp) {
    await sendMetaWhatsAppTemplate(order.whatsapp, order.nome, env);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. CRIAR PIX DINÂMICO NO MERCADO PAGO
    if (pathname === '/api/criar-pix' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { nome, whatsapp, matricula, lotacao, opcao } = body;

        if (!nome || !whatsapp) {
          return jsonResponse({ error: 'Nome e WhatsApp são obrigatórios.' }, 400);
        }

        if (!env.MP_ACCESS_TOKEN) {
          return jsonResponse({ error: 'MP_ACCESS_TOKEN não configurado no servidor.' }, 500);
        }

        const valor = opcao === '100' ? 100.0 : 200.0;
        const cleanPhone = formatPhoneBR(whatsapp);
        const idempotencyKey = crypto.randomUUID();
        const nameParts = nome.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'Polícia Penal';

        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            transaction_amount: valor,
            description: `Confraternização SEPPEN - ${valor === 200 ? 'À Vista' : '1ª Parcela'}`,
            payment_method_id: 'pix',
            notification_url: `${url.origin}/api/webhook/mercadopago`,
            payer: {
              email: 'ppsantosalexandre78@gmail.com',
              first_name: firstName,
              last_name: lastName,
            },
            metadata: {
              nome: nome.trim(),
              whatsapp: cleanPhone,
              matricula: matricula || '',
              lotacao: lotacao || '',
              opcao: String(valor),
            },
          }),
        });

        const mpData = await mpRes.json();
        const txData = mpData.point_of_interaction?.transaction_data;

        if (!mpRes.ok || !txData) {
          console.error('[CRIAR_PIX] Erro Mercado Pago:', mpData);
          return jsonResponse({ error: 'Erro ao gerar Pix no Mercado Pago.', details: mpData.message }, 502);
        }

        const paymentId = String(mpData.id);
        const orderRecord = {
          paymentId,
          nome: nome.trim(),
          whatsapp: cleanPhone,
          matricula: matricula || '',
          lotacao: lotacao || '',
          opcao: String(valor),
          valor,
          status: 'pending',
          whatsapp_enviado: false,
          createdAt: new Date().toISOString(),
        };

        await env.SEPPEN_KV.put(`order:${paymentId}`, JSON.stringify(orderRecord));

        return jsonResponse({
          success: true,
          paymentId,
          pixCopiaCola: txData.qr_code,
          qrCodeBase64: txData.qr_code_base64,
          valor,
        });
      } catch (err) {
        console.error('[CRIAR_PIX] Exception:', err);
        return jsonResponse({ error: 'Falha interna ao processar pedido.' }, 500);
      }
    }

    // 2. WEBHOOK MERCADO PAGO
    if (pathname === '/api/webhook/mercadopago' && request.method === 'POST') {
      try {
        let paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
        if (!paymentId) {
          const payload = await request.json().catch(() => ({}));
          paymentId = payload?.data?.id || payload?.id;
        }

        if (paymentId) {
          ctx.waitUntil(processMercadoPagoWebhook(String(paymentId), env));
        }

        return jsonResponse({ received: true }, 200);
      } catch (err) {
        return jsonResponse({ received: true }, 200);
      }
    }

    // 3. CONSULTA DE STATUS PARA O FRONTEND (POLLING)
    if (pathname.startsWith('/api/status/') && request.method === 'GET') {
      const paymentId = pathname.replace('/api/status/', '').trim();
      if (!paymentId) return jsonResponse({ error: 'ID inválido' }, 400);

      const order = await env.SEPPEN_KV.get(`order:${paymentId}`, { type: 'json' });
      if (!order) {
        return jsonResponse({ status: 'pending', groupUrl: null }, 200);
      }

      // Só revela o link do grupo do WhatsApp quando o pagamento estiver aprovado
      return jsonResponse({
        status: order.status,
        groupUrl: order.status === 'approved' ? (env.WHATSAPP_GROUP_URL || null) : null,
      });
    }

    // 4. EXPORTAÇÃO CSV PARA O ORGANIZADOR (ALEXANDRE)
    if (pathname === '/api/admin/export' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
        return new Response('Acesso não autorizado', { status: 401 });
      }

      const ids = (await env.SEPPEN_KV.get('approved_ids', { type: 'json' })) || [];
      const rows = [
        'ID_Pagamento,Data_Aprovacao,Nome_Completo,Matricula,Lotacao_Unidade,WhatsApp,Opcao_Pagamento,Valor_Pago,Saldo_Devedor,Status_Pagamento,WhatsApp_Enviado',
      ];

      for (const id of ids) {
        const order = await env.SEPPEN_KV.get(`order:${id}`, { type: 'json' });
        if (!order) continue;
        const isIntegral = Number(order.valor) >= 200;
        const saldo = isIntegral ? '0.00' : '100.00';
        const statusLabel = isIntegral ? 'QUITADO' : 'PARCELA 1 PAGA';
        rows.push(
          `"${order.paymentId}","${order.approvedAt || order.createdAt}","${order.nome}","${order.matricula}","${order.lotacao}","${order.whatsapp}","${isIntegral ? 'À Vista' : 'Parcelado 2x'}",${Number(order.valor).toFixed(2)},${saldo},"${statusLabel}","${order.whatsapp_enviado ? 'Sim' : 'Não'}"`
        );
      }

      return new Response(rows.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="planilha_controle_evento_seppen.csv"',
        },
      });
    }

    // 5. SERVIR ARQUIVOS ESTÁTICOS (HTML / IMAGENS)
    return env.ASSETS.fetch(request);
  },
};
