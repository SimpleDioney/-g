# StreamChat API - Documentação

Esta documentação descreve os endpoints disponíveis na API do StreamChat.

## Base URL

```
https://api.streamchat.com
```

## Autenticação

A API utiliza autenticação JWT (JSON Web Token) para proteger a maioria dos endpoints.

### Fluxo de Autenticação

1. Obtenha um token JWT através dos endpoints de autenticação
2. Inclua o token em todas as requisições subsequentes no header:

```
Authorization: Bearer {seu_token_jwt}
```

3. Se o token expirar, utilize o refresh token para obter um novo token de acesso

## Endpoints de Autenticação

### Registro de Usuário

**Endpoint:** `POST /api/auth/register`

**Body:**
```json
{
  "email": "usuario@exemplo.com",
  "username": "novousuario",
  "password": "senha123"
}
```

**Resposta:**
```json
{
  "message": "Usuário criado com sucesso",
  "user": {
    "id": "uuid-do-usuario",
    "email": "usuario@exemplo.com",
    "username": "novousuario",
    "displayName": "novousuario",
    "avatar": null
  },
  "accessToken": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Login

**Endpoint:** `POST /api/auth/login`

**Body:**
```json
{
  "email": "usuario@exemplo.com",
  "password": "senha123"
}
```

**Resposta:**
```json
{
  "message": "Login realizado com sucesso",
  "user": {
    "id": "uuid-do-usuario",
    "email": "usuario@exemplo.com",
    "username": "usuario",
    "displayName": "Usuario",
    "avatar": "url-do-avatar",
    "status": "online",
    "bio": "Descrição do perfil",
    "isPremium": false,
    "level": 5,
    "xpPoints": 450
  },
  "accessToken": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Verificação 2FA

**Endpoint:** `POST /api/auth/verify2fa`

**Body:**
```json
{
  "tempToken": "token-temporario-recebido-no-login",
  "code": "123456"
}
```

**Resposta:**
```json
{
  "message": "Autenticação de dois fatores bem-sucedida",
  "user": {
    "id": "uuid-do-usuario",
    "email": "usuario@exemplo.com",
    "username": "usuario",
    "displayName": "Usuario",
    "avatar": "url-do-avatar",
    "status": "online"
  },
  "accessToken": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Renovar Token

**Endpoint:** `POST /api/auth/refresh-token`

**Body:**
```json
{
  "refreshToken": "seu-refresh-token"
}
```

**Resposta:**
```json
{
  "message": "Token atualizado com sucesso",
  "accessToken": "novo-jwt-token"
}
```

### Logout

**Endpoint:** `POST /api/auth/logout`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "refreshToken": "seu-refresh-token"
}
```

**Resposta:**
```json
{
  "message": "Logout realizado com sucesso"
}
```

## Endpoints de Usuários

### Obter Perfil do Usuário Atual

**Endpoint:** `GET /api/users/profile`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "user": {
    "id": "uuid-do-usuario",
    "email": "usuario@exemplo.com",
    "username": "usuario",
    "displayName": "Usuario",
    "avatar": "url-do-avatar",
    "avatarType": "image",
    "bio": "Descrição do perfil",
    "isPremium": false,
    "level": 5,
    "xpPoints": 450,
    "status": "online",
    "activity": {
      "type": "playing",
      "name": "Minecraft"
    }
  },
  "stats": {
    "serverCount": 7,
    "videoCount": 12,
    "latestServer": {
      "id": "uuid-do-servidor",
      "name": "Meu Servidor",
      "icon": "url-do-icone"
    }
  }
}
```

### Atualizar Perfil

**Endpoint:** `PUT /api/users/profile`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "displayName": "Novo Nome",
  "bio": "Nova descrição do perfil",
  "status": "busy"
}
```

**Resposta:**
```json
{
  "message": "Perfil atualizado com sucesso",
  "user": {
    "id": "uuid-do-usuario",
    "username": "usuario",
    "displayName": "Novo Nome",
    "bio": "Nova descrição do perfil",
    "status": "busy",
    "avatar": "url-do-avatar",
    "avatarType": "image"
  }
}
```

### Upload de Avatar

**Endpoint:** `POST /api/users/avatar`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
Content-Type: multipart/form-data
```

**Body:**
```
avatar: [arquivo de imagem]
avatarType: "image" | "2D" | "3D"
```

**Resposta:**
```json
{
  "message": "Avatar atualizado com sucesso",
  "avatar": "url-do-avatar",
  "avatarType": "image"
}
```

### Obter Perfil Público de Usuário

**Endpoint:** `GET /api/users/{id}`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "user": {
    "id": "uuid-do-usuario",
    "username": "outro_usuario",
    "displayName": "Outro Usuário",
    "avatar": "url-do-avatar",
    "avatarType": "image",
    "bio": "Descrição do perfil",
    "level": 10,
    "xpPoints": 980,
    "createdAt": "2023-01-15T12:30:45Z",
    "status": "online"
  },
  "stats": {
    "videoCount": 15,
    "serverCount": 5
  }
}
```

## Endpoints de Servidores

### Criar Servidor

**Endpoint:** `POST /api/servers`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "name": "Meu Novo Servidor",
  "description": "Descrição do servidor",
  "isPrivate": false
}
```

**Resposta:**
```json
{
  "message": "Servidor criado com sucesso",
  "server": {
    "id": "uuid-do-servidor",
    "name": "Meu Novo Servidor",
    "description": "Descrição do servidor",
    "inviteCode": "abcd1234",
    "isPrivate": false,
    "channels": [
      {
        "id": "uuid-do-canal",
        "name": "geral",
        "type": "text"
      },
      {
        "id": "uuid-do-canal",
        "name": "boas-vindas",
        "type": "text"
      },
      {
        "id": "uuid-do-canal",
        "name": "Voz",
        "type": "voice"
      }
    ]
  }
}
```

### Obter Servidores do Usuário

**Endpoint:** `GET /api/servers`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "servers": [
    {
      "id": "uuid-do-servidor",
      "name": "Meu Servidor",
      "description": "Descrição do servidor",
      "icon": "url-do-icone",
      "isPrivate": false,
      "memberCount": 25,
      "role": "owner",
      "joinedAt": "2023-01-15T12:30:45Z"
    },
    {
      "id": "uuid-do-servidor-2",
      "name": "Outro Servidor",
      "description": "Outro servidor",
      "icon": "url-do-icone",
      "isPrivate": true,
      "memberCount": 10,
      "role": "member",
      "joinedAt": "2023-02-20T14:15:30Z"
    }
  ]
}
```

### Obter Detalhes do Servidor

**Endpoint:** `GET /api/servers/{id}`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "server": {
    "id": "uuid-do-servidor",
    "name": "Meu Servidor",
    "description": "Descrição do servidor",
    "icon": "url-do-icone",
    "inviteCode": "abcd1234",
    "isPrivate": false,
    "memberCount": 25,
    "isPremium": false,
    "premiumTier": 0,
    "createdAt": "2023-01-15T12:30:45Z",
    "owner": {
      "id": "uuid-do-usuario",
      "username": "usuario",
      "displayName": "Usuario",
      "avatar": "url-do-avatar",
      "avatarType": "image"
    },
    "channels": {
      "text": [
        {
          "id": "uuid-do-canal",
          "name": "geral",
          "type": "text",
          "position": 0,
          "isPrivate": false
        }
      ],
      "voice": [
        {
          "id": "uuid-do-canal",
          "name": "Voz",
          "type": "voice",
          "position": 2,
          "isPrivate": false
        }
      ],
      "announcement": []
    },
    "userRole": "owner"
  },
  "members": [
    {
      "id": "uuid-do-usuario",
      "username": "usuario",
      "displayName": "Usuario",
      "avatar": "url-do-avatar",
      "avatarType": "image",
      "role": "owner",
      "joinedAt": "2023-01-15T12:30:45Z",
      "status": "online"
    },
    {
      "id": "uuid-do-usuario-2",
      "username": "outro_usuario",
      "displayName": "Outro Usuário",
      "avatar": "url-do-avatar",
      "avatarType": "image",
      "role": "member",
      "joinedAt": "2023-01-16T10:20:30Z",
      "status": "offline"
    }
  ]
}
```

## Endpoints de Canais

### Criar Canal

**Endpoint:** `POST /api/servers/{serverId}/channels`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "name": "novo-canal",
  "type": "text",
  "isPrivate": false
}
```

**Resposta:**
```json
{
  "message": "Canal criado com sucesso",
  "channel": {
    "id": "uuid-do-canal",
    "name": "novo-canal",
    "type": "text",
    "serverId": "uuid-do-servidor",
    "isPrivate": false,
    "position": 3
  }
}
```

### Obter Mensagens do Canal

**Endpoint:** `GET /api/channels/{id}/messages`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Query Params:**
- `before`: ID da mensagem para paginação (opcional)
- `limit`: Número de mensagens (padrão: 50)

**Resposta:**
```json
{
  "messages": [
    {
      "id": "uuid-da-mensagem",
      "content": "Conteúdo da mensagem",
      "channelId": "uuid-do-canal",
      "userId": "uuid-do-usuario",
      "type": "text",
      "attachments": null,
      "reactions": {
        "👍": ["uuid-usuario-1", "uuid-usuario-2"],
        "❤️": ["uuid-usuario-3"]
      },
      "mentions": null,
      "replyToId": null,
      "isEdited": false,
      "isPinned": false,
      "createdAt": "2023-06-10T15:30:45Z",
      "updatedAt": "2023-06-10T15:30:45Z",
      "user": {
        "id": "uuid-do-usuario",
        "username": "usuario",
        "displayName": "Usuario",
        "avatar": "url-do-avatar",
        "avatarType": "image"
      }
    }
  ],
  "hasMore": true
}
```

## Endpoints de Mensagens

### Enviar Mensagem

**Endpoint:** `POST /api/messages`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "channelId": "uuid-do-canal",
  "content": "Conteúdo da mensagem",
  "attachments": null,
  "replyToId": null,
  "type": "text"
}
```

**Resposta:**
```json
{
  "message": "Mensagem enviada com sucesso",
  "data": {
    "id": "uuid-da-mensagem",
    "content": "Conteúdo da mensagem",
    "channelId": "uuid-do-canal",
    "userId": "uuid-do-usuario",
    "type": "text",
    "attachments": null,
    "reactions": {},
    "mentions": null,
    "replyToId": null,
    "isEdited": false,
    "isPinned": false,
    "createdAt": "2023-06-10T15:30:45Z",
    "updatedAt": "2023-06-10T15:30:45Z",
    "user": {
      "id": "uuid-do-usuario",
      "username": "usuario",
      "displayName": "Usuario",
      "avatar": "url-do-avatar",
      "avatarType": "image"
    }
  }
}
```

### Editar Mensagem

**Endpoint:** `PUT /api/messages/{id}`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "content": "Conteúdo atualizado da mensagem"
}
```

**Resposta:**
```json
{
  "message": "Mensagem atualizada com sucesso",
  "data": {
    "id": "uuid-da-mensagem",
    "content": "Conteúdo atualizado da mensagem",
    "isEdited": true,
    "updatedAt": "2023-06-10T15:40:15Z"
  }
}
```

## Endpoints de Vídeos

### Upload de Vídeo

**Endpoint:** `POST /api/videos/upload`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
Content-Type: multipart/form-data
```

**Body:**
```
video: [arquivo de vídeo]
title: "Título do vídeo"
description: "Descrição do vídeo"
tags: ["tag1", "tag2"]
```

**Resposta:**
```json
{
  "message": "Vídeo enviado e está sendo processado",
  "video": {
    "id": "uuid-do-video",
    "title": "Título do vídeo",
    "status": "processing"
  }
}
```

### Obter Detalhes do Vídeo

**Endpoint:** `GET /api/videos/{id}`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "video": {
    "id": "uuid-do-video",
    "title": "Título do vídeo",
    "description": "Descrição do vídeo",
    "userId": "uuid-do-usuario",
    "url": "url-do-video",
    "thumbnailUrl": "url-da-thumbnail",
    "duration": 60.5,
    "likes": 42,
    "views": 1024,
    "shares": 15,
    "comments": 8,
    "status": "published",
    "isPublic": true,
    "tags": ["tag1", "tag2"],
    "createdAt": "2023-06-10T15:30:45Z",
    "updatedAt": "2023-06-10T15:40:15Z",
    "User": {
      "id": "uuid-do-usuario",
      "username": "usuario",
      "displayName": "Usuario",
      "avatar": "url-do-avatar",
      "avatarType": "image"
    }
  }
}
```

### Feed de Vídeos

**Endpoint:** `GET /api/videos/feed`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Query Params:**
- `page`: Número da página (padrão: 1)
- `limit`: Vídeos por página (padrão: 10)
- `userId`: Filtrar por usuário (opcional)

**Resposta:**
```json
{
  "videos": [
    {
      "id": "uuid-do-video",
      "title": "Título do vídeo",
      "description": "Descrição do vídeo",
      "thumbnailUrl": "url-da-thumbnail",
      "duration": 45.2,
      "likes": 76,
      "views": 1520,
      "shares": 23,
      "comments": 14,
      "createdAt": "2023-06-10T15:30:45Z",
      "User": {
        "id": "uuid-do-usuario",
        "username": "usuario",
        "displayName": "Usuario",
        "avatar": "url-do-avatar",
        "avatarType": "image"
      }
    }
  ],
  "totalCount": 42,
  "currentPage": 1,
  "totalPages": 5,
  "hasMore": true
}
```

## Endpoints de Pagamentos

### Obter Produtos Disponíveis

**Endpoint:** `GET /api/payments/products`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Resposta:**
```json
{
  "products": [
    {
      "id": "tokens_100",
      "name": "100 Tokens",
      "description": "Pacote de 100 tokens para usar na plataforma",
      "price": 9.99,
      "tokens": 100,
      "currency": "BRL"
    },
    {
      "id": "tokens_500",
      "name": "500 Tokens",
      "description": "Pacote de 500 tokens para usar na plataforma",
      "price": 39.99,
      "tokens": 500,
      "currency": "BRL"
    }
  ],
  "subscriptions": [
    {
      "id": "premium_monthly",
      "name": "Assinatura Premium Mensal",
      "description": "Acesso a todos os recursos premium + 200 tokens mensais",
      "price": 19.99,
      "currency": "BRL",
      "interval": "month",
      "tokens": 200,
      "features": [
        "Modo sem anúncios",
        "Upload de vídeos ilimitado",
        "Servidores premium",
        "Avatares exclusivos",
        "Badge Premium"
      ]
    }
  ]
}
```

### Iniciar Checkout com Stripe

**Endpoint:** `POST /api/payments/checkout/stripe`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "productId": "tokens_100",
  "returnUrl": "https://streamchat.com/payment/confirmation"
}
```

**Resposta:**
```json
{
  "sessionId": "cs_test_xxxxx",
  "paymentId": "uuid-do-pagamento",
  "url": "https://checkout.stripe.com/pay/cs_test_xxxxx"
}
```

## Endpoints de Administração

### Configurar Moderação do Servidor

**Endpoint:** `PUT /api/admin/servers/{id}/moderation`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "autoModeration": "warn",
  "customWords": ["palavra1", "palavra2"],
  "notifyModerators": true
}
```

**Resposta:**
```json
{
  "message": "Configurações de moderação atualizadas",
  "settings": {
    "autoModeration": "warn",
    "customWords": ["palavra1", "palavra2"],
    "notifyModerators": true
  }
}
```

### Banir Usuário

**Endpoint:** `POST /api/admin/servers/{serverId}/ban/{userId}`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
```

**Body:**
```json
{
  "reason": "Violação das regras",
  "deleteMessages": true,
  "duration": 24 // horas
}
```

**Resposta:**
```json
{
  "message": "Usuário username banido com sucesso",
  "duration": "24 horas"
}
```

## WebSocket Events

A comunicação em tempo real é feita via Socket.IO.

### Autenticação WebSocket

```javascript
socket.auth = { token: "seu-jwt-token" };
socket.connect();
```

### Eventos de Conexão

#### Ao Conectar
```javascript
socket.on('connect', () => {
  console.log('Conectado com sucesso');
});
```

#### Entrar nos Servidores e Canais
```javascript
socket.emit('join_rooms');

socket.on('rooms_joined', ({ servers }) => {
  console.log('Entrou nos servidores:', servers);
});

socket.emit('join_channel', 'uuid-do-canal');

socket.on('channel_joined', ({ channelId, messages }) => {
  console.log('Entrou no canal:', channelId);
  console.log('Mensagens recentes:', messages);
});
```

### Eventos de Mensagens

#### Enviar Mensagem
```javascript
socket.emit('send_message', {
  channelId: 'uuid-do-canal',
  content: 'Olá, mundo!',
  attachments: null,
  replyToId: null,
  type: 'text'
});

socket.on('message_sent', ({ messageId }) => {
  console.log('Mensagem enviada com sucesso:', messageId);
});
```

#### Receber Nova Mensagem
```javascript
socket.on('new_message', (message) => {
  console.log('Nova mensagem recebida:', message);
});
```

#### Indicador de Digitação
```javascript
socket.emit('start_typing', 'uuid-do-canal');
socket.emit('stop_typing', 'uuid-do-canal');

socket.on('user_typing', ({ channelId, userId, username }) => {
  console.log(`${username} está digitando no canal ${channelId}`);
});

socket.on('user_stop_typing', ({ channelId, userId }) => {
  console.log(`Usuário ${userId} parou de digitar no canal ${channelId}`);
});
```

### Eventos de Presença

#### Atualizar Status
```javascript
socket.emit('set_status', 'online'); // 'online', 'away', 'busy', 'invisible', 'offline'

socket.on('status_updated', ({ status }) => {
  console.log('Status atualizado para:', status);
});
```

#### Mudanças de Status de Usuários
```javascript
socket.on('user_status_changed', ({ userId, status }) => {
  console.log(`Usuário ${userId} mudou status para ${status}`);
});
```

#### Atualizar Atividade
```javascript
socket.emit('update_activity', {
  activity: {
    type: 'playing',
    name: 'Minecraft'
  }
});
```

### Eventos de Voz

#### Entrar em Canal de Voz
```javascript
socket.emit('join_voice_channel', 'uuid-do-canal-voz');

socket.on('voice_channel_joined', ({ channelId, users }) => {
  console.log('Entrou no canal de voz:', channelId);
  console.log('Usuários presentes:', users);
});
```

#### Sair de Canal de Voz
```javascript
socket.emit('leave_voice_channel');

socket.on('voice_channel_left', ({ success }) => {
  console.log('Saiu do canal de voz');
});
```

#### Controles de Áudio
```javascript
socket.emit('toggle_mute', true); // Mutar microfone
socket.emit('toggle_deafen', true); // Desativar áudio

socket.on('user_mute_changed', ({ channelId, userId, isMuted }) => {
  console.log(`Usuário ${userId} ${isMuted ? 'mutou' : 'desmutou'} o microfone`);
});

socket.on('user_deafen_changed', ({ channelId, userId, isDeafened }) => {
  console.log(`Usuário ${userId} ${isDeafened ? 'desativou' : 'ativou'} o áudio`);
});
```

### Eventos de Notificação

#### Nova Notificação
```javascript
socket.on('new_notification', (notification) => {
  console.log('Nova notificação:', notification);
});
```

#### Menção
```javascript
socket.on('mention', ({ message, channel, server }) => {
  console.log(`Você foi mencionado por ${message.user.username} no canal #${channel.name}`);
});
```

#### Level Up
```javascript
socket.on('level_up', ({ level, xpPoints }) => {
  console.log(`Você subiu para o nível ${level}! (XP: ${xpPoints})`);
});
```