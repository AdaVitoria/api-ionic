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

  // Criar tabela se não existir
  const criarTabelaClientes = `
    CREATE TABLE IF NOT EXISTS clientes (
      id INT NOT NULL AUTO_INCREMENT,
      nome VARCHAR(100) NOT NULL,
      endereco VARCHAR(255) NOT NULL,
      foto_perfil VARCHAR(255) DEFAULT NULL,
      email VARCHAR(255) NOT NULL,
      senha VARCHAR(255) DEFAULT NULL,
      login VARCHAR(255) NOT NULL,
      status ENUM('ativo', 'pendente') DEFAULT 'pendente',
      tipo ENUM('admin', 'user') DEFAULT 'user',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const criarTabelaImagens = `CREATE TABLE IF NOT EXISTS imagens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url TEXT NOT NULL,
      descricao TEXT NOT NULL,
      nome VARCHAR(255) NOT NULL,
      id_cliente INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (id_cliente) REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`;

  db.query(criarTabelaClientes, (err, result) => {
    if (err) {
      console.error("Erro ao criar tabela 'clientes':", err);
    } else {
      console.log("Tabela 'clientes' verificada/criada com sucesso.");
    }
  });

  db.query(criarTabelaImagens, (err, result) => {
    if (err) {
      console.error("Erro ao criar tabela 'imagens':", err);
    } else {
      console.log("Tabela 'imagens' verificada/criada com sucesso.");
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

async function enviarEmail(email, nome, endereco, login) {
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
          <p><strong>Endereço:</strong> ${endereco}</p>
          <p><strong>E-mail:</strong> ${email}</p>
          <p><strong>Login:</strong> ${login}</p>

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
app.post("/login", async (req, res) => {
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ error: "Login e senha são obrigatórios" });
  }

  try {
    const sql = "SELECT * FROM clientes WHERE login = ?";
    db.query(sql, [login], async (err, results) => {
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
          login: user.login,
          tipo: user.tipo,
        },
      });
    });
  } catch (error) {
    console.error("Erro ao fazer login:", error);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

app.post("/clientes", async (req, res) => {
  const { nome, endereco, email, senha, login } = req.body;

  if (!nome || !endereco || !email || !senha || !login) {
    return res
      .status(400)
      .json({ error: "Nome, endereço, email, senha e login são obrigatórios" });
  }

  try {
    const senhaCriptografada = await bcrypt.hash(senha, 10);
    const sql =
      "INSERT INTO clientes (nome, endereco, email, senha, login) VALUES (?, ?, ?, ?, ?)";

    db.query(
      sql,
      [nome, endereco, email, senhaCriptografada, login],
      async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ error: "Erro ao solicitar cadastro de cliente" });
        }

        // Chamada da função para envio de e-mail
        try {
          await enviarEmail(email, nome, endereco, login);
          console.log("Notificação de nova solicitação enviada.");
        } catch (emailErr) {
          console.error("Erro ao enviar e-mail de notificação:", emailErr);
          // Continua o fluxo mesmo se o e-mail falhar
        }

        res.status(201).json({
          message: "Solicitação de Cadastro Realizada!",
          id: result.insertId,
        });
      }
    );
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

// Rota para atualizar um cliente com upload de foto
app.put("/clientes/:id", upload.single("fotoPerfil"), (req, res) => {
  const { id } = req.params;
  const { nome, endereco } = req.body;
  const foto_perfil = req.file ? `/uploads/${req.file.filename}` : null;

  if (!nome || !endereco) {
    return res.status(400).json({ error: "Nome e endereço são obrigatórios" });
  }

  const sql =
    "UPDATE clientes SET nome = ?, endereco = ?, foto_perfil = ? WHERE id = ?";
  db.query(sql, [nome, endereco, foto_perfil, id], (err, updateResult) => {
    if (err) {
      console.error("Erro no banco de dados:", err);
      return res.status(500).json({ error: "Erro ao atualizar cliente" });
    }
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }
    res.json({ message: "Cliente atualizado com sucesso!", foto_perfil });
  });
});

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

// Rotas protegidas
app.use(verificarToken);

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
