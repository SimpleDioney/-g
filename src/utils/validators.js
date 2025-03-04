const Joi = require('joi');

// Validador de usuários
const userValidator = {
  // Validar registro
  register: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'E-mail inválido',
      'string.empty': 'E-mail é obrigatório',
      'any.required': 'E-mail é obrigatório'
    }),
    username: Joi.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).required().messages({
      'string.min': 'Nome de usuário deve ter pelo menos 3 caracteres',
      'string.max': 'Nome de usuário deve ter no máximo 30 caracteres',
      'string.pattern.base': 'Nome de usuário deve conter apenas letras, números e _',
      'string.empty': 'Nome de usuário é obrigatório',
      'any.required': 'Nome de usuário é obrigatório'
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Senha deve ter pelo menos 6 caracteres',
      'string.empty': 'Senha é obrigatória',
      'any.required': 'Senha é obrigatória'
    })
  }),
  
  // Validar login
  login: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'E-mail inválido',
      'string.empty': 'E-mail é obrigatório',
      'any.required': 'E-mail é obrigatório'
    }),
    password: Joi.string().required().messages({
      'string.empty': 'Senha é obrigatória',
      'any.required': 'Senha é obrigatória'
    })
  }),
  
  // Validar atualização de perfil
  updateProfile: Joi.object({
    displayName: Joi.string().min(1).max(50).allow(null, '').messages({
      'string.min': 'Nome de exibição deve ter pelo menos 1 caractere',
      'string.max': 'Nome de exibição deve ter no máximo 50 caracteres'
    }),
    bio: Joi.string().max(300).allow(null, '').messages({
      'string.max': 'Biografia deve ter no máximo 300 caracteres'
    }),
    status: Joi.string().valid('online', 'away', 'busy', 'invisible', 'offline').messages({
      'any.only': 'Status inválido'
    })
  }),
  
  // Validar alteração de senha
  changePassword: Joi.object({
    currentPassword: Joi.string().required().messages({
      'string.empty': 'Senha atual é obrigatória',
      'any.required': 'Senha atual é obrigatória'
    }),
    newPassword: Joi.string().min(6).required().messages({
      'string.min': 'Nova senha deve ter pelo menos 6 caracteres',
      'string.empty': 'Nova senha é obrigatória',
      'any.required': 'Nova senha é obrigatória'
    })
  })
};

// Validador de servidores
const serverValidator = {
  // Validar criação de servidor
  create: Joi.object({
    name: Joi.string().min(1).max(100).required().messages({
      'string.min': 'Nome do servidor deve ter pelo menos 1 caractere',
      'string.max': 'Nome do servidor deve ter no máximo 100 caracteres',
      'string.empty': 'Nome do servidor é obrigatório',
      'any.required': 'Nome do servidor é obrigatório'
    }),
    description: Joi.string().max(500).allow(null, '').messages({
      'string.max': 'Descrição deve ter no máximo 500 caracteres'
    }),
    isPrivate: Joi.boolean().default(false)
  }),
  
  // Validar atualização de servidor
  update: Joi.object({
    name: Joi.string().min(1).max(100).messages({
      'string.min': 'Nome do servidor deve ter pelo menos 1 caractere',
      'string.max': 'Nome do servidor deve ter no máximo 100 caracteres',
      'string.empty': 'Nome do servidor é obrigatório'
    }),
    description: Joi.string().max(500).allow(null, '').messages({
      'string.max': 'Descrição deve ter no máximo 500 caracteres'
    }),
    isPrivate: Joi.boolean()
  })
};

// Validador de canais
const channelValidator = {
  // Validar criação de canal
  create: Joi.object({
    name: Joi.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).required().messages({
      'string.min': 'Nome do canal deve ter pelo menos 1 caractere',
      'string.max': 'Nome do canal deve ter no máximo 100 caracteres',
      'string.pattern.base': 'Nome do canal deve conter apenas letras, números, _ e -',
      'string.empty': 'Nome do canal é obrigatório',
      'any.required': 'Nome do canal é obrigatório'
    }),
    type: Joi.string().valid('text', 'voice', 'video', 'announcement').required().messages({
      'any.only': 'Tipo de canal inválido',
      'any.required': 'Tipo de canal é obrigatório'
    }),
    isPrivate: Joi.boolean().default(false)
  }),
  
  // Validar atualização de canal
  update: Joi.object({
    name: Joi.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).messages({
      'string.min': 'Nome do canal deve ter pelo menos 1 caractere',
      'string.max': 'Nome do canal deve ter no máximo 100 caracteres',
      'string.pattern.base': 'Nome do canal deve conter apenas letras, números, _ e -'
    }),
    slowMode: Joi.number().min(0).max(3600).messages({
      'number.min': 'Slow mode deve ser maior ou igual a 0',
      'number.max': 'Slow mode deve ser menor ou igual a 3600 segundos (1 hora)'
    })
  })
};

// Validador de mensagens
const messageValidator = {
  // Validar criação de mensagem
  create: Joi.object({
    channelId: Joi.string().required().messages({
      'string.empty': 'ID do canal é obrigatório',
      'any.required': 'ID do canal é obrigatório'
    }),
    content: Joi.string().max(4000).required().messages({
      'string.max': 'Mensagem deve ter no máximo 4000 caracteres',
      'string.empty': 'Conteúdo da mensagem é obrigatório',
      'any.required': 'Conteúdo da mensagem é obrigatório'
    }),
    attachments: Joi.any(),
    replyToId: Joi.string().allow(null),
    type: Joi.string().valid('text', 'image', 'video', 'audio', 'file', 'gif', 'system').default('text')
  }),
  
  // Validar atualização de mensagem
  update: Joi.object({
    content: Joi.string().max(4000).required().messages({
      'string.max': 'Mensagem deve ter no máximo 4000 caracteres',
      'string.empty': 'Conteúdo da mensagem é obrigatório',
      'any.required': 'Conteúdo da mensagem é obrigatório'
    })
  }),
  
  // Validar enquete
  createPoll: Joi.object({
    channelId: Joi.string().required().messages({
      'string.empty': 'ID do canal é obrigatório',
      'any.required': 'ID do canal é obrigatório'
    }),
    question: Joi.string().min(3).max(200).required().messages({
      'string.min': 'Pergunta deve ter pelo menos 3 caracteres',
      'string.max': 'Pergunta deve ter no máximo 200 caracteres',
      'string.empty': 'Pergunta é obrigatória',
      'any.required': 'Pergunta é obrigatória'
    }),
    options: Joi.array().items(Joi.string().min(1).max(100)).min(2).max(10).required().messages({
      'array.min': 'Enquete deve ter pelo menos 2 opções',
      'array.max': 'Enquete deve ter no máximo 10 opções',
      'any.required': 'Opções são obrigatórias'
    }),
    expiresIn: Joi.number().min(0).max(604800).messages({
      'number.min': 'Tempo de expiração deve ser maior ou igual a 0',
      'number.max': 'Tempo de expiração deve ser menor ou igual a 604800 segundos (7 dias)'
    })
  })
};

// Validador de vídeos
const videoValidator = {
  // Validar criação de vídeo
  create: Joi.object({
    title: Joi.string().min(3).max(100).required().messages({
      'string.min': 'Título deve ter pelo menos 3 caracteres',
      'string.max': 'Título deve ter no máximo 100 caracteres',
      'string.empty': 'Título é obrigatório',
      'any.required': 'Título é obrigatório'
    }),
    description: Joi.string().max(500).allow(null, '').messages({
      'string.max': 'Descrição deve ter no máximo 500 caracteres'
    }),
    tags: Joi.array().items(Joi.string().min(1).max(20)).max(10).messages({
      'array.max': 'Vídeo pode ter no máximo 10 tags',
      'string.max': 'Tag deve ter no máximo 20 caracteres'
    }),
    isPublic: Joi.boolean().default(true)
  }),
  
  // Validar comentário
  createComment: Joi.object({
    content: Joi.string().min(1).max(500).required().messages({
      'string.min': 'Comentário deve ter pelo menos 1 caractere',
      'string.max': 'Comentário deve ter no máximo 500 caracteres',
      'string.empty': 'Comentário é obrigatório',
      'any.required': 'Comentário é obrigatório'
    }),
    parentId: Joi.string().allow(null)
  })
};

// Validador de pagamentos
const paymentValidator = {
  // Validar checkout
  checkout: Joi.object({
    productId: Joi.string().required().messages({
      'string.empty': 'ID do produto é obrigatório',
      'any.required': 'ID do produto é obrigatório'
    }),
    returnUrl: Joi.string().uri().messages({
      'string.uri': 'URL de retorno inválida'
    })
  }),
  
  // Validar envio de presente
  sendGift: Joi.object({
    receiverId: Joi.string().required().messages({
      'string.empty': 'ID do destinatário é obrigatório',
      'any.required': 'ID do destinatário é obrigatório'
    }),
    amount: Joi.number().integer().min(1).required().messages({
      'number.base': 'Quantidade de tokens deve ser um número',
      'number.integer': 'Quantidade de tokens deve ser um número inteiro',
      'number.min': 'Quantidade de tokens deve ser maior ou igual a 1',
      'any.required': 'Quantidade de tokens é obrigatória'
    }),
    message: Joi.string().max(200).allow(null, '').messages({
      'string.max': 'Mensagem deve ter no máximo 200 caracteres'
    })
  }),
  
  // Validar super chat
  superChat: Joi.object({
    channelId: Joi.string().required().messages({
      'string.empty': 'ID do canal é obrigatório',
      'any.required': 'ID do canal é obrigatório'
    }),
    amount: Joi.number().integer().min(1).required().messages({
      'number.base': 'Quantidade de tokens deve ser um número',
      'number.integer': 'Quantidade de tokens deve ser um número inteiro',
      'number.min': 'Quantidade de tokens deve ser maior ou igual a 1',
      'any.required': 'Quantidade de tokens é obrigatória'
    }),
    message: Joi.string().max(200).allow(null, '').messages({
      'string.max': 'Mensagem deve ter no máximo 200 caracteres'
    })
  })
};

// Exportar validadores
module.exports = {
  userValidator,
  serverValidator,
  channelValidator,
  messageValidator,
  videoValidator,
  paymentValidator,
  
  // Função de validação genérica
  validate: (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        error: 'Erro de validação',
        details: errors
      });
    }
    
    next();
  }
};