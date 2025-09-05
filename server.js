process.env.TZ = "UTC"; // Força o Node.js a usar UTC

import "dotenv/config";
import express from "express";
import mysql from "mysql2";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { URL } from "url"; // Para manipular a URL de conexão

// Obtenha __dirname em módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Recupera a URL do banco de dados do arquivo .env
const dbUrl = new URL(process.env.DB_URL);

// Configuração do MySQL usando as informações extraídas da URL
const db = mysql.createConnection({
  host: dbUrl.hostname,
  port: dbUrl.port || 3306,
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.substring(1),
});

db.connect((err) => {
  if (err) {
    console.error("Erro ao conectar ao MySQL:", err);
    return;
  }
  console.log("Conectado ao MySQL!");

  // Criar tabela de clientes (mantida como está)
  const criarTabelaClientes = `
  CREATE TABLE IF NOT EXISTS clientes (
    id INT NOT NULL AUTO_INCREMENT,
    nome VARCHAR(100) NOT NULL,
    foto_perfil VARCHAR(255) DEFAULT NULL,
    email VARCHAR(255) NOT NULL,
    senha VARCHAR(255) DEFAULT NULL,
    status ENUM('ativo', 'pendente') DEFAULT 'pendente',
    tipo ENUM('admin', 'user') DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- <-- ADICIONE ESTA LINHA
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
`;

  // TABELA NOVA: categorias
  const criarTabelaCategorias = `
    CREATE TABLE IF NOT EXISTS categorias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL UNIQUE,
      descricao TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  // TABELA 1: insetos (agora com id_categoria e FOREIGN KEY)
  const criarTabelaInsetos = `
    CREATE TABLE IF NOT EXISTS insetos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome_comum VARCHAR(100) NOT NULL,
      nome_cientifico VARCHAR(255),
      id_categoria INT,
      descricao TEXT,
      habitat TEXT,
      comportamento TEXT,
      FOREIGN KEY (id_categoria) REFERENCES categorias(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  // TABELA 2: imagens_inseto (mantida como está)
  const criarTabelaImagensInseto = `
    CREATE TABLE IF NOT EXISTS imagens_inseto (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_inseto INT NOT NULL,
      url_imagem TEXT NOT NULL,
      descricao TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_inseto) REFERENCES insetos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  // TRIGGER: Gatilho para limitar 3 imagens por inseto
  // O MySQL não permite múltiplos statements em um único db.query() por padrão.
  // Por isso, o DELIMITER não é necessário aqui, a instrução já está separada.
  const criarGatilhoImagens = `
    CREATE TRIGGER tr_verificar_limite_imagens
    BEFORE INSERT ON imagens_inseto
    FOR EACH ROW
    BEGIN
        DECLARE num_imagens INT;

        SELECT COUNT(*) INTO num_imagens FROM imagens_inseto WHERE id_inseto = NEW.id_inseto;

        IF num_imagens >= 3 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Não é possível adicionar mais de 3 imagens por inseto.';
        END IF;
    END;
  `;

  db.query(criarTabelaClientes, (err, result) => {
    if (err) {
      console.error("Erro ao criar tabela 'clientes':", err);
    } else {
      console.log("Tabela 'clientes' verificada/criada com sucesso.");
    }
  });

  db.query(criarTabelaCategorias, (err) => {
    if (err) {
      console.error("Erro ao criar tabela 'categorias':", err);
    } else {
      console.log("Tabela 'categorias' verificada/criada com sucesso.");

      db.query(criarTabelaInsetos, (err) => {
        if (err) {
          console.error("Erro ao criar tabela 'insetos':", err);
        } else {
          console.log("Tabela 'insetos' verificada/criada com sucesso.");

          db.query(criarTabelaImagensInseto, (err) => {
            if (err) {
              console.error("Erro ao criar tabela 'imagens_inseto':", err);
            } else {
              console.log(
                "Tabela 'imagens_inseto' verificada/criada com sucesso."
              );

              // Executar a criação do gatilho após todas as tabelas estarem prontas
              //db.query(criarGatilhoImagens, (err) => {
              // if (err) {
              // O gatilho pode já existir, o que causaria um erro. Ignorar se for esse o caso.
              //if (err.code !== "ER_SP_DOES_NOT_EXIST") {
              //    console.error(
              //        "Erro ao criar gatilho 'tr_verificar_limite_imagens':",
              //        err
              ////    //  );
              //  }
              //} else {
              //console.log(
              //"Gatilho 'tr_verificar_limite_imagens' criado com sucesso."
              //);
              //}
              //});
            }
          });
        }
      });
    }
  });
});

// Configuração do Multer para upload de arquivos
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Middleware para verificar o token JWT
const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(403).json({ error: "Token não fornecido" });
  }

  const token = authHeader.split(" ")[1]; // separa "Bearer" do token

  jwt.verify(
    token,
    process.env.JWT_SECRET || "sua-chave-secreta",
    (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: "Token inválido" });
      }

      req.user = decoded;
      next();
    }
  );
};

async function enviarEmail(email, nome) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: '"Administrador do Sistema Ionic" <adavitoriapereiraferreira@gmail.com>',
    to: "adavitoriapereiraferreira@gmail.com",
    subject: "Nova solicitação de cadastro pendente!",
    html: `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Nova solicitação pendente</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f7f7f7;
            padding: 20px;
            color: #333;
          }
          .container {
            background-color: #fff;
            border-radius: 10px;
            padding: 30px;
            max-width: 600px;
            margin: auto;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #007bff;
          }
          p {
            font-size: 16px;
          }
          .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #777;
          }
          .button {
            display: inline-block;
            padding: 10px 20px;
            margin-top: 20px;
            font-size: 16px;
            color: #fff;
            background-color: #007bff;
            text-decoration: none;
            border-radius: 5px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Nova solicitação de cadastro</h1>
          <p><strong>Nome:</strong> ${nome}</p>
          <p><strong>E-mail:</strong> ${email}</p>

          <a class="button" href="http://localhost:8100/solicitacoes" target="_blank">Verificar solicitações</a>

          <p>Atenciosamente,<br />Equipe do Sistema</p>
          <div class="footer">
            <p>Este e-mail foi enviado automaticamente, por favor não responda.</p>
          </div>
        </div>
      </body>
    </html>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("E-mail enviado:", info.response);
    return true;
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    return false;
  }
}

const verificarAdmin = (req, res, next) => {
  if (req.user.tipo !== "admin") {
    // Supondo que o tipo está no token JWT
    return res.status(403).json({ error: "Acesso negado" });
  }
  next();
};

// Rotas públicas

app.get("/hello-world", (req, res) => {
  // Este console.log aparecerá no seu terminal do backend
  // sempre que a rota for acessada. É ótimo para depuração!
  console.log("A rota /hello-world foi acessada!");

  // Envia uma resposta JSON simples para o cliente
  res.status(200).json({
    message: "Hello World! A conexão com o backend está funcionando!",
  });
});
app.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  try {
    const sql = "SELECT * FROM clientes WHERE email = ?";
    db.query(sql, [email], async (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao buscar usuário" });
      }

      if (results.length === 0) {
        return res.status(400).json({ error: "Usuário não encontrado" });
      }

      const user = results[0];
      const senhaValida = await bcrypt.compare(senha, user.senha);

      if (!senhaValida) {
        return res.status(400).json({ error: "Senha incorreta" });
      }

      const payload = { id: user.id, tipo: user.tipo };
      const token = jwt.sign(
        payload,
        process.env.JWT_SECRET || "minha-chave-secreta",
        {
          expiresIn: "1h",
        }
      );

      res.status(200).json({
        message: "Login realizado com sucesso",
        token,
        user: {
          id: user.id,
          email: user.email,
          tipo: user.tipo,
        },
      });
    });
  } catch (error) {
    console.error("Erro ao fazer login:", error);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

// Rota para dados do gráfico de pizza (status de usuários)
app.get("/dashboard/status-usuarios", (req, res) => {
  const sql = `
    SELECT status, COUNT(*) as quantidade 
    FROM clientes 
    GROUP BY status
  `;
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar dados de status." });
    }
    res.json(results);
  });
});

// Rota para dados do gráfico de linhas (cadastros por dia)
app.get("/dashboard/cadastros-por-dia", (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ error: "Datas de início e fim são obrigatórias." });
  }

  const sql = `
    SELECT DATE(created_at) as dia, COUNT(*) as quantidade 
    FROM clientes 
    WHERE DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at) 
    ORDER BY dia ASC
  `;
  db.query(sql, [inicio, fim], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Erro ao buscar dados de cadastros." });
    }
    res.json(results);
  });
});

app.post("/clientes", async (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res
      .status(400)
      .json({ error: "Nome, email e senha  são obrigatórios" });
  }

  try {
    const senhaCriptografada = await bcrypt.hash(senha, 10);
    const sql = "INSERT INTO clientes (nome, email, senha) VALUES (?, ?, ?)";

    db.query(sql, [nome, email, senhaCriptografada], async (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Erro ao solicitar cadastro de cliente" });
      }

      // Chamada da função para envio de e-mail
      try {
        await enviarEmail(email, nome);
        console.log("Notificação de nova solicitação enviada.");
      } catch (emailErr) {
        console.error("Erro ao enviar e-mail de notificação:", emailErr);
        // Continua o fluxo mesmo se o e-mail falhar
      }

      res.status(201).json({
        message: "Solicitação de Cadastro Realizada!",
        id: result.insertId,
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criptografar a senha" });
  }
});

// Rota para adicionar uma imagem (agora com id_cliente)
app.post("/imagens", upload.single("imagem"), (req, res) => {
  const { nome, descricao, id_cliente } = req.body;
  const foto_perfil = req.file ? `/uploads/${req.file.filename}` : null;

  if (!nome || !descricao || !req.file || !id_cliente) {
    return res.status(400).json({
      error: "Nome, descrição, id_cliente e imagem são obrigatórios",
    });
  }

  const sql =
    "INSERT INTO imagens (url, descricao, nome, id_cliente) VALUES (?, ?, ?, ?)";
  db.query(sql, [foto_perfil, descricao, nome, id_cliente], (err, result) => {
    if (err) {
      console.error("Erro ao inserir imagem:", err);
      return res
        .status(500)
        .json({ error: "Erro ao inserir imagem no banco de dados" });
    }

    res.status(201).json({
      message: "Imagem salva com sucesso!",
      imagemId: result.insertId,
      url: foto_perfil,
    });
  });
});

// Rota para deletar uma imagem (mantida igual, mas agora tem relação com cliente)
app.delete("/imagens/:id", (req, res) => {
  const { id } = req.params;

  // Primeiro busca a URL da imagem
  const buscaSql = "SELECT url FROM imagens WHERE id = ?";
  db.query(buscaSql, [id], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ error: "Imagem não encontrada" });
    }

    const imagePath = path.join(__dirname, results[0].url);

    // Remove o registro do banco
    const deleteSql = "DELETE FROM imagens WHERE id = ?";
    db.query(deleteSql, [id], (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao deletar imagem" });
      }

      // Tenta remover o arquivo do disco
      fs.unlink(imagePath, (err) => {
        if (err) {
          console.warn("Imagem removida do banco, mas não do disco:", err);
        }
        return res.json({ message: "Imagem deletada com sucesso!" });
      });
    });
  });
});

// Rota para editar uma imagem (agora verificando se o cliente é dono da imagem)
app.put("/imagens/:id", upload.single("imagem"), (req, res) => {
  const { id } = req.params;
  const { nome, descricao, id_cliente } = req.body;
  const novaUrl = req.file ? `/uploads/${req.file.filename}` : null;

  if (!nome || !descricao || !id_cliente) {
    return res
      .status(400)
      .json({ error: "Nome, descrição e id_cliente são obrigatórios" });
  }

  // Verifica se a imagem pertence ao cliente antes de editar
  const verificaSql =
    "SELECT id, url FROM imagens WHERE id = ? AND id_cliente = ?";
  db.query(verificaSql, [id, id_cliente], (err, results) => {
    if (err || results.length === 0) {
      return res
        .status(404)
        .json({ error: "Imagem não encontrada ou não pertence ao cliente" });
    }

    // Se tem nova imagem, remove a anterior
    if (novaUrl) {
      const imagemAntiga = path.join(__dirname, results[0].url);

      // Atualiza com nova imagem
      const sql =
        "UPDATE imagens SET nome = ?, descricao = ?, url = ? WHERE id = ?";
      db.query(sql, [nome, descricao, novaUrl, id], (err, result) => {
        if (err) {
          return res.status(500).json({ error: "Erro ao atualizar imagem" });
        }

        // Tenta remover imagem antiga
        fs.unlink(imagemAntiga, (err) => {
          if (err) {
            console.warn("Imagem antiga não removida:", err);
          }
        });

        res.json({ message: "Imagem atualizada com sucesso!" });
      });
    } else {
      // Atualiza sem trocar a imagem
      const sql = "UPDATE imagens SET nome = ?, descricao = ? WHERE id = ?";
      db.query(sql, [nome, descricao, id], (err, result) => {
        if (err) {
          return res.status(500).json({ error: "Erro ao atualizar imagem" });
        }
        res.json({ message: "Imagem atualizada com sucesso!" });
      });
    }
  });
});

// Rota para retornar todas as imagens (agora com filtro por cliente opcional)
app.get("/imagens", (req, res) => {
  const { id_cliente } = req.query;
  let sql =
    "SELECT id, url, descricao, nome, created_at, id_cliente FROM imagens";
  let params = [];

  if (id_cliente) {
    sql += " WHERE id_cliente = ?";
    params.push(id_cliente);
  }

  sql += " ORDER BY created_at DESC";

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar imagens" });
    }
    res.json(results);
  });
});

// Rota para retornar imagens em um período (agora com filtro por cliente opcional)
app.get("/imagens/periodo", (req, res) => {
  const { inicio, fim, id_cliente } = req.query;

  if (!inicio || !fim) {
    return res.status(400).json({
      error: "As datas 'inicio' e 'fim' são obrigatórias no formato YYYY-MM-DD",
    });
  }

  let sql = `
  SELECT 
    DATE(created_at) as date, 
    COUNT(*) as count 
  FROM imagens
  WHERE created_at BETWEEN ? AND ?
`;
  let params = [inicio, fim];

  if (id_cliente) {
    sql += " AND id_cliente = ?";
    params.push(id_cliente);
  }

  sql += " ORDER BY created_at DESC";

  db.query(sql, params, (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Erro ao buscar imagens por período" });
    }
    res.json(results);
  });
});

// Rota para retornar uma imagem pelo id (agora com verificação de cliente)
app.get("/imagens/:id", (req, res) => {
  const { id } = req.params;
  const { id_cliente } = req.query;

  let sql =
    "SELECT id, url, descricao, nome, created_at, id_cliente FROM imagens WHERE id = ?";
  let params = [id];

  if (id_cliente) {
    sql += " AND id_cliente = ?";
    params.push(id_cliente);
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar imagem" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "Imagem não encontrada" });
    }
    res.json(results[0]);
  });
});

app.get("/api/imagens-por-dia", (req, res) => {
  const query = `
    SELECT DATE(created_at) AS data, COUNT(*) AS quantidade
    FROM imagens
    GROUP BY DATE(created_at)
    ORDER BY data ASC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Erro ao buscar imagens por dia:", err);
      return res.status(500).json({ erro: "Erro interno do servidor" });
    }

    res.json(results);
  });
});

// SUBSTITUA A SUA ROTA app.put("/clientes/:id", ...) POR ESTA:

app.put(
  "/clientes/:id",
  verificarToken,
  upload.single("foto_perfil"),
  async (req, res) => {
    const { id } = req.params;
    const { nome, email, senha } = req.body;
    const usuarioLogado = req.user; // Informações do token JWT (id, tipo)

    // --- VERIFICAÇÃO DE PERMISSÃO ---
    // Um usuário só pode editar a si mesmo, a menos que seja um admin.
    if (usuarioLogado.tipo !== "admin" && usuarioLogado.id.toString() !== id) {
      return res.status(403).json({
        error: "Acesso negado. Você só pode editar seu próprio perfil.",
      });
    }

    if (!nome || !email) {
      return res.status(400).json({ error: "Nome e email são obrigatórios." });
    }

    try {
      let sql = "UPDATE clientes SET nome = ?, email = ?";
      const params = [nome, email];

      // Se uma nova senha for fornecida, criptografa e adiciona à query
      if (senha && senha.trim() !== "") {
        const senhaCriptografada = await bcrypt.hash(senha, 10);
        sql += ", senha = ?";
        params.push(senhaCriptografada);
      }

      // Se uma nova foto de perfil for enviada
      if (req.file) {
        const foto_perfil_url = `/uploads/${req.file.filename}`;
        sql += ", foto_perfil = ?";
        params.push(foto_perfil_url);
      }

      sql += " WHERE id = ?";
      params.push(id);

      db.query(sql, params, (err, result) => {
        if (err) {
          console.error("Erro ao atualizar cliente:", err);
          return res
            .status(500)
            .json({ error: "Erro interno ao atualizar perfil." });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Usuário não encontrado." });
        }
        res.json({ message: "Perfil atualizado com sucesso!" });
      });
    } catch (error) {
      res.status(500).json({ error: "Erro ao processar a requisição." });
    }
  }
);

app.get("/clientes/:id", (req, res) => {
  const { id } = req.params;
  const sql = "SELECT * FROM clientes WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar cliente" });
    }
    if (result.length === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }
    res.json(result[0]);
  });
});

// Servir arquivos estáticos da pasta "uploads"
app.use("/uploads", express.static(uploadsDir));
// ROTAS PARA INSETOS
app.get("/insetos", (req, res) => {
  // A lógica da função 'read' vem diretamente para cá
  let sql = `
    SELECT 
      i.*, 
      GROUP_CONCAT(ii.url_imagem) as imagens 
    FROM 
      insetos i
    LEFT JOIN 
      imagens_inseto ii ON i.id = ii.id_inseto
    WHERE 1=1
  `;
  const params = [];
  const filtro = req.query; // Os filtros vêm de req.query

  if (filtro.id) {
    sql += " AND i.id = ?";
    params.push(filtro.id);
  }
  if (filtro.nome_comum) {
    sql += " AND i.nome_comum LIKE ?";
    params.push(`%${filtro.nome_comum}%`);
  }
  if (filtro.id_categoria) {
    sql += " AND i.id_categoria = ?";
    params.push(filtro.id_categoria);
  }

  sql += " GROUP BY i.id"; // Agrupa os resultados por inseto

  // O callback do db.query envia a resposta (res)
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Rotas protegidas
app.use(verificarToken);

// Adicione estas rotas no seu index.js, por exemplo, depois da rota de login

// CRUD de Categorias
const crudCategorias = {
  create: (nome, descricao, callback) => {
    const sql = `INSERT INTO categorias (nome, descricao) VALUES (?, ?)`;
    db.query(sql, [nome, descricao], callback);
  },
  read: (id, callback) => {
    let sql = "SELECT * FROM categorias";
    const params = [];
    if (id) {
      sql += " WHERE id = ?";
      params.push(id);
    }
    db.query(sql, params, callback);
  },
  update: (id, nome, descricao, callback) => {
    const sql = `UPDATE categorias SET nome = ?, descricao = ? WHERE id = ?`;
    db.query(sql, [nome, descricao, id], callback);
  },
  delete: (id, callback) => {
    const sql = `DELETE FROM categorias WHERE id = ?`;
    db.query(sql, [id], callback);
  },
};

// CRUD de Insetos
const crudInsetos = {
  create: (
    nome_comum,
    nome_cientifico,
    id_categoria,
    descricao,
    habitat,
    comportamento,
    callback
  ) => {
    const sql = `INSERT INTO insetos (nome_comum, nome_cientifico, id_categoria, descricao, habitat, comportamento) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [
      nome_comum,
      nome_cientifico,
      id_categoria,
      descricao,
      habitat,
      comportamento,
    ];
    db.query(sql, params, callback);
  },
  read: (filtro, callback) => {
    let sql = "SELECT * FROM insetos WHERE 1=1";
    const params = [];
    if (filtro.id) {
      sql += " AND id = ?";
      params.push(filtro.id);
    }
    if (filtro.nome_comum) {
      sql += " AND nome_comum LIKE ?";
      params.push(`%${filtro.nome_comum}%`);
    }
    if (filtro.id_categoria) {
      sql += " AND id_categoria = ?";
      params.push(filtro.id_categoria);
    }
    db.query(sql, params, callback);
  },
  update: (id, dados, callback) => {
    const updates = Object.keys(dados).map((key) => `${key} = ?`);
    const values = Object.values(dados);
    values.push(id);
    const sql = `UPDATE insetos SET ${updates.join(", ")} WHERE id = ?`;
    db.query(sql, values, callback);
  },
  delete: (id, callback) => {
    const sql = `DELETE FROM insetos WHERE id = ?`;
    db.query(sql, [id], callback);
  },
};

// CRUD de Imagens de Inseto
// ROTA NOVA: Adicionar UMA imagem a um inseto
app.post(
  "/insetos/:id_inseto/imagem",
  verificarToken, // Protegendo a rota
  upload.single("imagem"), // 'imagem' no singular
  (req, res) => {
    const { id_inseto } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }

    // 1. Verificar quantas imagens o inseto já tem
    const countSql =
      "SELECT COUNT(*) as total FROM imagens_inseto WHERE id_inseto = ?";
    db.query(countSql, [id_inseto], (err, results) => {
      if (err) {
        // Se der erro, apaga o arquivo que já foi salvo pelo multer
        fs.unlink(req.file.path, () => {});
        return res
          .status(500)
          .json({ error: "Erro ao verificar imagens existentes." });
      }

      if (results[0].total >= 3) {
        fs.unlink(req.file.path, () => {});
        return res
          .status(400)
          .json({ error: "Limite de 3 imagens por inseto já atingido." });
      }

      // 2. Se o limite não foi atingido, insere a nova imagem
      const url_imagem = `/uploads/${req.file.filename}`;
      const insertSql =
        "INSERT INTO imagens_inseto (id_inseto, url_imagem) VALUES (?, ?)";
      db.query(insertSql, [id_inseto, url_imagem], (err, result) => {
        if (err) {
          fs.unlink(req.file.path, () => {});
          return res.status(500).json({ error: "Erro ao salvar a imagem." });
        }
        // Retorna o objeto da imagem recém-criada para o frontend
        res.status(201).json({ id: result.insertId, id_inseto, url_imagem });
      });
    });
  }
);

// ROTA NOVA: Deletar UMA imagem de inseto pelo seu ID específico
app.delete("/insetos/imagens/:id_imagem", verificarToken, (req, res) => {
  const { id_imagem } = req.params;

  // 1. Buscar a imagem no banco para pegar a URL e deletar o arquivo físico
  const findSql = "SELECT url_imagem FROM imagens_inseto WHERE id = ?";
  db.query(findSql, [id_imagem], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Erro no banco de dados." });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "Imagem não encontrada." });
    }

    const filePath = path.join(__dirname, results[0].url_imagem);

    // 2. Deletar a imagem do banco de dados
    const deleteSql = "DELETE FROM imagens_inseto WHERE id = ?";
    db.query(deleteSql, [id_imagem], (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Erro ao deletar imagem do banco." });
      }

      // 3. Deletar o arquivo físico do servidor
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          // Loga o erro mas continua, pois o mais importante (banco) foi feito
          console.error("Erro ao deletar arquivo do disco:", unlinkErr);
        }
        res.status(200).json({ message: "Imagem deletada com sucesso." });
      });
    });
  });
});

const crudImagensInseto = {
  create: (id_inseto, url_imagem, descricao, callback) => {
    const sql = `INSERT INTO imagens_inseto (id_inseto, url_imagem, descricao) VALUES (?, ?, ?)`;
    db.query(sql, [id_inseto, url_imagem, descricao], callback);
  },
  read: (id_inseto, callback) => {
    const sql = `SELECT * FROM imagens_inseto WHERE id_inseto = ?`;
    db.query(sql, [id_inseto], callback);
  },
  update: (id, url_imagem, descricao, callback) => {
    const sql = `UPDATE imagens_inseto SET url_imagem = ?, descricao = ? WHERE id = ?`;
    db.query(sql, [url_imagem, descricao, id], callback);
  },
  delete: (id, callback) => {
    const sql = `DELETE FROM imagens_inseto WHERE id = ?`;
    db.query(sql, [id], callback);
  },
};

// ===============================
// Rotas da API
// ===============================

// ROTAS PARA CATEGORIAS
app.get("/categorias", (req, res) => {
  crudCategorias.read(null, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/categorias", (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome)
    return res
      .status(400)
      .json({ error: "O nome da categoria é obrigatório." });
  crudCategorias.create(nome, descricao, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res
      .status(201)
      .json({ id: result.insertId, message: "Categoria criada com sucesso." });
  });
});

app.put("/categorias/:id", (req, res) => {
  const { id } = req.params;
  const { nome, descricao } = req.body;
  crudCategorias.update(id, nome, descricao, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Categoria ID ${id} atualizada.` });
  });
});

app.delete("/categorias/:id", (req, res) => {
  const { id } = req.params;
  crudCategorias.delete(id, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Categoria ID ${id} deletada.` });
  });
});

app.put("/insetos/:id", (req, res) => {
  const { id } = req.params;
  crudInsetos.update(id, req.body, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Inseto ID ${id} atualizado.` });
  });
});

app.delete("/insetos/:id", (req, res) => {
  const { id } = req.params;
  crudInsetos.delete(id, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Inseto ID ${id} deletado.` });
  });
});

// ROTAS PARA IMAGENS_INSETO
app.get("/insetos/:id_inseto/imagens", (req, res) => {
  const { id_inseto } = req.params;
  crudImagensInseto.read(id_inseto, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post(
  "/insetos/:id_inseto/imagens",
  upload.array("images", 3),
  (req, res) => {
    const { id_inseto } = req.params;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Nenhuma imagem foi enviada." });
    }

    const inserts = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const url = `/uploads/${file.filename}`;
        crudImagensInseto.create(id_inseto, url, null, (err, result) => {
          if (err) {
            fs.unlink(file.path, () => {});
            return reject(err);
          }
          resolve(result.insertId);
        });
      });
    });

    Promise.all(inserts)
      .then((ids) => {
        res.status(201).json({
          message: `${ids.length} imagens adicionadas com sucesso.`,
          ids,
        });
      })
      .catch((err) => {
        res.status(400).json({ error: err.message });
      });
  }
);

app.delete("/imagens/:id_imagem", (req, res) => {
  const { id_imagem } = req.params;
  crudImagensInseto.read(null, (err, rows) => {
    // Busca a imagem para obter o URL
    if (err) return res.status(500).json({ error: err.message });
    const imagem = rows.find((row) => row.id == id_imagem);
    if (!imagem)
      return res.status(404).json({ error: "Imagem não encontrada." });

    const imagePath = path.join(__dirname, imagem.url_imagem);

    crudImagensInseto.delete(id_imagem, (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows > 0) {
        fs.unlink(imagePath, (unlinkErr) => {
          if (unlinkErr) console.error("Erro ao deletar arquivo:", unlinkErr);
          res.json({ message: "Imagem deletada com sucesso." });
        });
      } else {
        res.status(404).json({ message: "Nenhuma imagem deletada." });
      }
    });
  });
});

app.get("/clientes", verificarToken, verificarAdmin, (req, res) => {
  db.query("SELECT * FROM clientes where status = 'ativo'", (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar clientes" });
    }
    res.json(results);
  });
});

app.get("/clientesPendentes", verificarToken, verificarAdmin, (req, res) => {
  db.query(
    "SELECT * FROM clientes where status = 'pendente'",
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao buscar clientes" });
      }
      res.json(results);
    }
  );
});

app.delete("/clientes/:id", verificarToken, verificarAdmin, (req, res) => {
  const { id, email } = req.params;
  const sql = "DELETE FROM clientes WHERE id = ?";

  db.query(sql, [id], (err, deleteResult) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao excluir cliente" });
    }
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }
    res.json({ message: "Cliente excluído com sucesso!" });
  });
});

app.put("/aprovarUsuario", verificarToken, verificarAdmin, (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: "ID do usuário é obrigatório" });
  }

  // Primeiro, busca o e-mail do usuário
  const buscarEmailSql = "SELECT email FROM clientes WHERE id = ?";
  db.query(buscarEmailSql, [id], (err, results) => {
    if (err) {
      console.error("Erro ao buscar e-mail:", err);
      return res
        .status(500)
        .json({ error: "Erro ao buscar e-mail do usuário" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const emailUsuario = results[0].email;

    // Depois atualiza o status
    const aprovarSql = "UPDATE clientes SET status = 'ativo' WHERE id = ?";
    db.query(aprovarSql, [id], async (err, result) => {
      if (err) {
        console.error("Erro ao aprovar usuário:", err);
        return res.status(500).json({ error: "Erro ao aprovar usuário" });
      }

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ error: "Usuário não encontrado para aprovação" });
      }

      try {
        await enviarEmailConfirmacao(emailUsuario);
        res.json({ message: "Usuário aprovado com sucesso!" });
      } catch (emailError) {
        console.error("Erro ao enviar e-mail:", emailError);
        res
          .status(500)
          .json({ error: "Usuário aprovado, mas houve erro ao enviar e-mail" });
      }
    });
  });
});

// Rota para mover usuário para pendente
app.put("/usuarios/:id/pendente", (req, res) => {
  const { id } = req.params;

  const pendenteSql = "UPDATE clientes SET status = 'pendente' WHERE id = ?";
  db.query(pendenteSql, [id], (err, result) => {
    if (err) {
      console.error("Erro ao atualizar usuário para pendente:", err);
      return res
        .status(500)
        .json({ error: "Erro ao atualizar usuário para pendente" });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: "Usuário não encontrado para atualização" });
    }

    res.json({ message: "Usuário movido para pendente com sucesso!" });
  });
});

async function enviarEmailConfirmacao(destinatario) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "adavitoriapereiraferreira@gmail.com",
      pass: "yulw uljh kghx zfzv",
    },
  });

  const mailOptions = {
    from: '"Administrador do Sistema Ionic" <adavitoriapereiraferreira@gmail.com>',
    to: destinatario,
    subject: "Bem-vindo à nossa plataforma!",
    html: `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Bem-vindo</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f7f7f7;
            padding: 20px;
            color: #333;
          }
          .container {
            background-color: #fff;
            border-radius: 10px;
            padding: 30px;
            max-width: 600px;
            margin: auto;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #007bff;
          }
          p {
            font-size: 16px;
          }
          .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #777;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Bem-vindo(a) à nossa plataforma!</h1>
          <p>Olá,</p>
          <p>Seu cadastro foi aceito.</p>
          <p>Atenciosamente,<br />Equipe do Sistema</p>
          <div class="footer">
            <p>Este e-mail foi enviado automaticamente, por favor não responda.</p>
          </div>
        </div>
      </body>
    </html>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("E-mail enviado:", info.response);
    return true;
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    return false;
  }
}

app.get("/", (req, res) => {
  res.send("API rodando com sucesso!");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
