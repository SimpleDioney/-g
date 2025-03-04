# StreamChat - Backend

Backend completo para a rede social **StreamChat**, que combina funcionalidades do **Discord, TikTok e Telegram**. 

## 🌟 Visão Geral

O StreamChat é uma plataforma social inovadora que combina:
- **Comunicação em tempo real** similar ao Discord
- **Compartilhamento de vídeos curtos** similar ao TikTok
- **Canais de transmissão e recursos de mensagens** similar ao Telegram

## 🛠️ Tecnologias Utilizadas

### 🔄 Backend
- **Node.js** com **Express.js**
- **SQLite** com **Sequelize ORM**
- **Redis** para cache, filas e gerenciamento de sessões
- **Socket.io** para comunicação em tempo real

### 🔐 Autenticação & Segurança
- **JWT + Refresh Tokens**
- **OAuth2** (Google, Discord, Twitter, Facebook)
- **2FA** (Autenticação em Dois Fatores)
- **Rate Limiting** e proteção contra **DDoS**

### 📊 Dados & Processamento
- **Bull** para filas de processamento assíncrono
- **FFmpeg** para processamento de vídeo
- **Cloudinary** para armazenamento de mídia
- **Stripe & MercadoPago** para pagamentos

## 📋 Funcionalidades Principais

### 👤 Gerenciamento de Usuários & Perfis
- Perfis personalizáveis
- Avatares 2D e 3D animados
- Status online configurável
- Sistema de níveis e XP

### 💬 Comunicação em Tempo Real
- Servidores e canais (texto, voz, vídeo)
- Mensagens em tempo real (WebSockets)
- Canais de transmissão
- Mensagens autodestrutivas
- Pesquisa eficiente

### 🎬 Feed de Vídeos Curtos
- Upload e processamento de vídeos
- Edição no backend
- Sistema de likes, comentários e compartilhamentos
- Tendências e descoberta

### 💰 Monetização & Economia Virtual
- Super Chats e Presentes Virtuais
- Assinaturas Premium
- Tokens internos

### 🔔 Notificações e Engajamento
- Push notifications
- Sistema de streaks e recompensas
- Enquetes e enquetes por voz

### 🔒 Administração e Moderação
- Roles e permissões avançadas
- Filtros de conteúdo e detecção automática
- Logs de atividades

## 🧩 Estrutura do Backend

```
streamchat-backend/
├── src/
│   ├── config/                     // Configurações do sistema
│   ├── models/                     // Definição dos modelos de dados
│   ├── controllers/                // Controladores da API
│   ├── routes/                     // Rotas da API
│   ├── middlewares/                // Middlewares
│   ├── services/                   // Serviços da aplicação
│   ├── sockets/                    // Handlers de WebSockets
│   ├── utils/                      // Utilitários
│   ├── jobs/                       // Tarefas assíncronas
│   └── app.js                      // Entrada principal da aplicação
```

## 🚀 Como Executar

1. Clone o repositório
```bash
git clone https://github.com/yourusername/streamchat-backend.git
cd streamchat-backend
```

2. Instale as dependências
```bash
npm install
```

3. Configure as variáveis de ambiente
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Inicie o servidor
```bash
npm run dev
```

### 📝 Pré-requisitos
- Node.js v14+
- Redis
- SQLite ou outro banco de dados suportado pelo Sequelize
- FFmpeg (para processamento de vídeo)

## 📐 Modelo de Dados

O sistema utiliza os seguintes modelos principais:

- **User**: Usuários da plataforma
- **Server**: Servidores (similar a servidores do Discord)
- **Channel**: Canais dentro dos servidores
- **Message**: Mensagens enviadas nos canais
- **Video**: Vídeos curtos compartilhados
- **Transaction**: Transações financeiras e de tokens
- **Notification**: Notificações para os usuários

## 🔗 API Endpoints

### 🔐 Autenticação
- `POST /api/auth/register`: Registrar novo usuário
- `POST /api/auth/login`: Login
- `POST /api/auth/refresh-token`: Renovar token de acesso
- `POST /api/auth/verify2fa`: Verificar código 2FA
- `POST /api/auth/setup2fa`: Configurar 2FA
- `POST /api/auth/logout`: Logout

### 👤 Usuários
- `GET /api/users/profile`: Obter perfil do usuário atual
- `PUT /api/users/profile`: Atualizar perfil
- `GET /api/users/:id`: Obter informações de um usuário
- `GET /api/users/:id/videos`: Obter vídeos de um usuário

### 💬 Servidores & Canais
- `GET /api/servers`: Listar servidores do usuário
- `POST /api/servers`: Criar servidor
- `GET /api/servers/:id`: Obter detalhes do servidor
- `POST /api/servers/:id/channels`: Criar canal
- `GET /api/channels/:id/messages`: Obter mensagens de um canal

### 🎬 Vídeos
- `GET /api/videos/feed`: Obter feed de vídeos
- `POST /api/videos/upload`: Fazer upload de vídeo
- `GET /api/videos/:id`: Obter detalhes de um vídeo
- `POST /api/videos/:id/like`: Curtir vídeo
- `POST /api/videos/:id/comments`: Comentar em vídeo

### 💰 Pagamentos
- `GET /api/payments/products`: Listar produtos disponíveis
- `POST /api/payments/checkout/stripe`: Iniciar checkout Stripe
- `GET /api/payments/balance`: Obter saldo de tokens
- `POST /api/payments/gift`: Enviar presente para outro usuário

### 🔔 Notificações
- `GET /api/notifications`: Obter notificações
- `PATCH /api/notifications/:id/read`: Marcar notificação como lida
- `GET /api/notifications/streak`: Verificar streak diária

### 🔒 Administração
- `PUT /api/admin/servers/:id/moderation`: Configurar moderação do servidor
- `GET /api/admin/servers/:id/logs`: Obter logs de moderação
- `POST /api/admin/servers/:id/ban/:userId`: Banir usuário
- `PUT /api/admin/servers/:id/users/:userId/role`: Atualizar cargo de usuário

## 🔄 WebSockets

O sistema utiliza WebSockets para comunicação em tempo real:

### 📡 Eventos principais
- `connection`: Conexão inicial
- `join_channel`: Entrar em um canal
- `send_message`: Enviar mensagem
- `user_typing`: Indicador de digitação
- `new_message`: Nova mensagem recebida
- `user_status_changed`: Atualização de status de usuário
- `join_voice_channel`: Entrar em canal de voz

## 🧪 Testes

Execute os testes automatizados com:
```bash
npm test
```

## 📈 Escalabilidade

O sistema foi projetado com escalabilidade em mente:
- Uso de Redis para cache e estado compartilhado
- Sistema de filas para processamento assíncrono
- Arquitetura modular
- Suporte para múltiplas instâncias

## 📄 Licença

Este projeto está licenciado sob a licença MIT - veja o arquivo LICENSE para detalhes.

## 👥 Contribuições

Contribuições são bem-vindas! Por favor, sinta-se à vontade para enviar pull requests ou abrir issues para melhorar o projeto.