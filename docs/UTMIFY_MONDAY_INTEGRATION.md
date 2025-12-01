# UTMify → Monday.com Integration

Documentação completa da integração entre UTMify e Monday.com para sincronização automática de métricas de campanhas.

## Índice

1. [Visão Geral](#visão-geral)
2. [UTMify API](#utmify-api)
3. [Monday.com API](#mondaycom-api)
4. [Mapeamento de Dados](#mapeamento-de-dados)
5. [Script de Sincronização](#script-de-sincronização)
6. [GitHub Actions](#github-actions)
7. [Troubleshooting](#troubleshooting)

---

## Visão Geral

Esta integração busca métricas diárias de dashboards na UTMify e exporta para o Monday.com, onde:
- **Cada Dashboard UTMify** = **Item no Monday**
- **Cada Dia** = **Sub-item no Monday**

### Fluxo de Dados

```
UTMify Dashboard → API → Script Node.js → Monday.com API → Sub-items
```

### Métricas Sincronizadas

| UTMify | Monday | Descrição |
|--------|--------|-----------|
| `gastoAds` | Gasto | Valor gasto em anúncios |
| `receitaLiquida` | Faturado | Receita líquida do dia |
| `pedidosAprovados` | Conversões | Número de pedidos aprovados |

---

## UTMify API

### Base URL

```
https://server.utmify.com.br
```

> **Importante:** O servidor correto é `server.utmify.com.br`, NÃO `api.utmify.com.br`

### Autenticação

A UTMify usa dois métodos de autenticação:

#### 1. Login Inicial (Basic Auth)

```http
GET /users/auth
Authorization: Basic {base64(email:password)}
Accept: application/json
Origin: https://app.utmify.com.br
```

**Exemplo com curl:**
```bash
# Codificar credenciais em base64
AUTH=$(echo -n "email@example.com:senha123" | base64)

curl -X GET "https://server.utmify.com.br/users/auth" \
  -H "Authorization: Basic $AUTH" \
  -H "Accept: application/json" \
  -H "Origin: https://app.utmify.com.br"
```

**Resposta de Sucesso (200):**
```json
{
  "auth": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expInSecs": 3600
  },
  "data": {
    "user": {
      "email": "email@example.com",
      "name": "Nome do Usuário"
    }
  }
}
```

#### 2. Chamadas Autenticadas (Bearer Token)

Após o login, use o token JWT nas requisições:

```http
Authorization: Bearer {token}
```

### Endpoints

#### GET /dashboards

Lista todos os dashboards do usuário.

```bash
curl -X GET "https://server.utmify.com.br/dashboards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json"
```

**Resposta:**
```json
[
  {
    "_id": "68225b390535096c0ca5d99f",
    "name": "Salve Felipe",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  {
    "_id": "68225b390535096c0ca5d9a0",
    "name": "Maria Clara",
    "createdAt": "2024-02-20T14:00:00.000Z"
  }
]
```

#### POST /orders/dashboard-info

Retorna métricas agregadas de um dashboard para um período específico.

```bash
curl -X POST "https://server.utmify.com.br/orders/dashboard-info" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboardId": "68225b390535096c0ca5d99f",
    "dateRange": {
      "from": "2025-11-01T00:00:00.000Z",
      "to": "2025-11-30T23:59:59.999Z"
    },
    "screenSize": "xl",
    "resumoItems": [{"type": "ApprovalRate"}]
  }'
```

**Parâmetros:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `dashboardId` | string | ID do dashboard |
| `dateRange.from` | ISO 8601 | Data/hora inicial |
| `dateRange.to` | ISO 8601 | Data/hora final |
| `screenSize` | string | Tamanho da tela (`"xl"`, `"lg"`, `"md"`) |
| `resumoItems` | array | Itens extras no resumo |

**Resposta:**
```json
{
  "pedidosAprovados": 683,
  "pedidosPendentes": 45,
  "pedidosRecusados": 12,
  "receitaBruta": 35420.50,
  "receitaLiquida": 26940.04,
  "gastoAds": 19403.15,
  "ticketMedio": 39.44,
  "taxaAprovacao": 0.92,
  "roas": 1.39
}
```

#### POST /users/refresh-token

Renova o token JWT antes de expirar.

```bash
curl -X POST "https://server.utmify.com.br/users/refresh-token" \
  -H "Content-Type: application/json" \
  -d '{"token": "refresh_token_aqui"}'
```

### Outros Endpoints Úteis

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/orders/filters` | Filtros disponíveis para pedidos |
| GET | `/users/plan-info` | Informações do plano do usuário |
| POST | `/dashboards/meta/ad-accounts/list` | Contas de anúncio do Meta |
| POST | `/dashboards/google/profiles/list` | Perfis do Google Ads |
| POST | `/webhooks/objects/list` | Webhooks configurados |
| POST | `/api-credentials/list` | Credenciais de API |

---

## Monday.com API

### Base URL

```
https://api.monday.com/v2
```

### Autenticação

Use API Token no header:

```http
Authorization: {api_token}
Content-Type: application/json
```

> **Nota:** Monday.com usa GraphQL para todas as operações.

### Estrutura do Board

**Board:** 🚀 Pipeline de Campanhas (ID: `18282099872`)

**Grupos:**
- ✅ Completo - Pronto para Anunciar (`group_mkx4bj2q`)
- 📋 Em Progresso
- 🔄 Revisão

**Colunas de Sub-items:**

| Nome | Column ID | Tipo |
|------|-----------|------|
| Data | `date0` | Date |
| Gasto | `numeric_mky1cd8d` | Number |
| Faturado | `numeric_mky1hegz` | Number |
| Conversões | `numeric_mky11r84` | Number |

### Queries GraphQL

#### Listar Items do Board

```graphql
query {
  boards(ids: 18282099872) {
    items_page(limit: 50) {
      items {
        id
        name
        group { id title }
      }
    }
  }
}
```

#### Buscar Sub-items de um Item

```graphql
query ($itemId: [ID!]) {
  items(ids: $itemId) {
    subitems {
      id
      name
      column_values {
        id
        text
      }
    }
  }
}
```

#### Criar Sub-item

```graphql
mutation ($parentId: ID!, $name: String!, $columns: JSON!) {
  create_subitem(
    parent_item_id: $parentId,
    item_name: $name,
    column_values: $columns
  ) {
    id
  }
}
```

**Variáveis:**
```json
{
  "parentId": "18294458473",
  "name": "01/12/2025",
  "columns": "{\"date0\":{\"date\":\"2025-12-01\"},\"numeric_mky1cd8d\":\"19403.15\",\"numeric_mky1hegz\":\"26940.04\",\"numeric_mky11r84\":\"683\"}"
}
```

#### Atualizar Sub-item

```graphql
mutation ($itemId: ID!, $boardId: ID!, $columns: JSON!) {
  change_multiple_column_values(
    item_id: $itemId,
    board_id: $boardId,
    column_values: $columns
  ) {
    id
  }
}
```

---

## Mapeamento de Dados

### Dashboard → Item

| Dashboard UTMify | Item Monday | Item ID |
|------------------|-------------|---------|
| Maria Clara | Maria Clara | `18294458473` |

> Para adicionar novos dashboards, edite `DASHBOARD_ITEM_MAP` no script.

### Métricas → Colunas

| Campo UTMify | Campo Monday | Column ID |
|--------------|--------------|-----------|
| Data do período | Data | `date0` |
| `gastoAds` | Gasto | `numeric_mky1cd8d` |
| `receitaLiquida` | Faturado | `numeric_mky1hegz` |
| `pedidosAprovados` | Conversões | `numeric_mky11r84` |

---

## Script de Sincronização

### Arquivo: `utmify_monday_sync.js`

### Requisitos

- Node.js 18+
- Sem dependências externas (usa apenas `https` nativo)

### Variáveis de Ambiente

| Variável | Descrição | Obrigatório |
|----------|-----------|-------------|
| `UTMIFY_EMAIL` | Email de login UTMify | Sim |
| `UTMIFY_PASSWORD` | Senha UTMify | Sim |
| `MONDAY_API_KEY` | API Token do Monday | Sim |
| `MONDAY_BOARD_ID` | ID do board (default: 18282099872) | Não |

### Uso

```bash
# Sincronizar últimos 7 dias do dashboard "Maria Clara"
node utmify_monday_sync.js --dashboard "Maria Clara" --days 7

# Sincronizar últimos 30 dias
node utmify_monday_sync.js --dashboard "Maria Clara" --days 30

# Com variáveis de ambiente
UTMIFY_EMAIL=email@example.com \
UTMIFY_PASSWORD=senha123 \
MONDAY_API_KEY=eyJ... \
node utmify_monday_sync.js --dashboard "Maria Clara" --days 7
```

### Saída Esperada

```
╔══════════════════════════════════════════════════════════════╗
║          UTMify → Monday.com Sync                           ║
╚══════════════════════════════════════════════════════════════╝

Dashboard: Maria Clara
Days: 7

🔐 Logging in to UTMify...
✅ UTMify login successful
📊 Fetching dashboards...
✅ Found dashboard: Maria Clara (68225b390535096c0ca5d99f)

📈 Fetching 7 days of metrics...
  📊 2025-12-01: Gasto=19403.15, Faturado=26940.04, Conversões=683
  📊 2025-11-30: Gasto=20109.54, Faturado=32201.04, Conversões=772
  ...

📤 Syncing 7 days to Monday.com...
  ✏️ Updated: 01/12/2025
  ✏️ Updated: 30/11/2025
  ➕ Created: 29/11/2025
  ...
✅ Monday sync complete

🎉 Sync completed successfully!
```

### Adicionar Novo Dashboard

Edite o objeto `DASHBOARD_ITEM_MAP` no script:

```javascript
const DASHBOARD_ITEM_MAP = {
  'Maria Clara': { itemId: '18294458473', dashboardId: null },
  'Novo Dashboard': { itemId: 'ID_DO_ITEM_MONDAY', dashboardId: null },
};
```

---

## GitHub Actions

### Arquivo: `.github/workflows/utmify-monday-sync.yml`

### Configurar Secrets

1. Acesse o repositório no GitHub
2. Vá em **Settings** → **Secrets and variables** → **Actions**
3. Adicione os secrets:

| Secret | Valor |
|--------|-------|
| `UTMIFY_EMAIL` | Seu email UTMify |
| `UTMIFY_PASSWORD` | Sua senha UTMify |
| `MONDAY_API_KEY` | Token API do Monday |

### Execução Automática

O workflow roda automaticamente **todo dia às 8:00 AM (horário de Brasília)**.

Cron: `0 11 * * *` (11:00 UTC = 8:00 BRT)

### Execução Manual

1. Vá em **Actions** → **UTMify → Monday Sync**
2. Clique em **Run workflow**
3. Preencha:
   - **Dashboard name:** Nome do dashboard (ex: "Maria Clara")
   - **Number of days:** Quantidade de dias (ex: 7)
4. Clique em **Run workflow**

### Logs

Veja os logs em **Actions** → Selecione a execução → **sync**

---

## Troubleshooting

### Erro: "UTMify login failed"

**Causa:** Credenciais incorretas ou servidor indisponível.

**Solução:**
1. Verifique email e senha
2. Teste manualmente:
```bash
curl -X GET "https://server.utmify.com.br/users/auth" \
  -H "Authorization: Basic $(echo -n 'email:senha' | base64)" \
  -H "Origin: https://app.utmify.com.br"
```

### Erro: "Dashboard not found"

**Causa:** Nome do dashboard não corresponde exatamente.

**Solução:**
1. Liste os dashboards disponíveis (o script mostra quando falha)
2. Use o nome exato (case-insensitive, mas deve conter o texto)

### Erro: "Monday API error"

**Causa:** Token inválido ou sem permissão.

**Solução:**
1. Verifique se o token está correto
2. Teste:
```bash
curl -X POST "https://api.monday.com/v2" \
  -H "Authorization: SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ me { name } }"}'
```

### Erro: "No Monday.com mapping found"

**Causa:** Dashboard não mapeado para item do Monday.

**Solução:**
1. Encontre o Item ID no Monday (URL ou via API)
2. Adicione ao `DASHBOARD_ITEM_MAP` no script

### Dados duplicados no Monday

**Causa:** Sub-items com mesma data.

**Solução:** O script verifica por data antes de criar. Se houver duplicatas:
1. Delete manualmente os duplicados no Monday
2. Execute o sync novamente

---

## Referências

- [UTMify](https://app.utmify.com.br/)
- [Monday.com API Docs](https://developer.monday.com/api-reference/docs)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

---

*Última atualização: Dezembro 2025*
