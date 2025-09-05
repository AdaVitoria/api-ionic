process.env.TZ = "UTC";

import "dotenv/config";
import express from "express";
import mysql from "mysql2";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { URL } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const dbUrl = new URL(process.env.DB_URL);

const db = mysql
  .createPool({
    host: dbUrl.hostname,
    port: dbUrl.port || 3306,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.substring(1),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })
  .promise();

// --- ATENÇÃO ---
// Toda a lógica de upload de arquivos com 'multer' foi removida.
// A Vercel não suporta o salvamento de arquivos em disco.

// --- Middlewares e Funções Auxiliares ---
const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader)
    return res.status(403).json({ error: "Token não fornecido" });
  const token = authHeader.split(" ")[1];
  jwt.verify(
    token,
    process.env.JWT_SECRET || "sua-chave-secreta",
    (err, decoded) => {
      if (err) return res.status(403).json({ error: "Token inválido" });
      req.user = decoded;
      next();
    }
  );
};

const verificarAdmin = (req, res, next) => {
  if (req.user.tipo !== "admin") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  next();
};

// --- FUNÇÃO DE E-MAIL RESTAURADA ---
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
    to: "adavitoriapereiraferreira@gmail.com", // E-mail do admin
    subject: "Nova solicitação de cadastro pendente!",
    html: `
            <h1>Nova solicitação de cadastro</h1>
            <p><strong>Nome:</strong> ${nome}</p>
            <p><strong>E-mail:</strong> ${email}</p>
            <p>Verifique o painel de administração para aprovar ou rejeitar.</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("E-mail de notificação enviado para o admin.");
    return true;
  } catch (error) {
    console.error("Erro ao enviar e-mail de notificação:", error);
    return false;
  }
}

// --- FUNÇÃO DE E-MAIL DE CONFIRMAÇÃO RESTAURADA ---
async function enviarEmailConfirmacao(destinatario) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: '"Administrador do Sistema Ionic" <adavitoriapereiraferreira@gmail.com>',
    to: destinatario,
    subject: "Bem-vindo à nossa plataforma!",
    html: `
            <h1>Bem-vindo(a) à nossa plataforma!</h1>
            <p>Olá,</p>
            <p>Seu cadastro foi aceito. Agora você pode acessar o aplicativo.</p>
            <p>Atenciosamente,<br />Equipe do Sistema</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("E-mail de confirmação enviado para:", destinatario);
    return true;
  } catch (error) {
    console.error("Erro ao enviar e-mail de confirmação:", error);
    return false;
  }
}

// ===============================
// ROTAS DA API
// ===============================

app.get("/", (req, res) => {
  res.send("API EntomoGuide rodando na Vercel!");
});

app.get("/hello-world", (req, res) => {
  res.status(200).json({ message: "Hello World! Conexão OK!" });
});

// --- Rotas Públicas ---
app.post("/login", async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  try {
    const sql = "SELECT * FROM clientes WHERE email = ?";
    const [results] = await db.query(sql, [email]);
    if (results.length === 0)
      return res.status(400).json({ error: "Usuário não encontrado" });

    const user = results[0];

    // Adiciona verificação de status
    if (user.status !== "ativo") {
      return res
        .status(403)
        .json({ error: "Seu cadastro está pendente de aprovação." });
    }

    const senhaValida = await bcrypt.compare(senha, user.senha);
    if (!senhaValida) return res.status(400).json({ error: "Senha incorreta" });

    const payload = { id: user.id, tipo: user.tipo };
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || "minha-chave-secreta",
      { expiresIn: "8h" }
    );
    res
      .status(200)
      .json({
        message: "Login realizado",
        token,
        user: { id: user.id, email: user.email, tipo: user.tipo },
      });
  } catch (error) {
    console.error("Erro /login:", error);
    res.status(500).json({ error: "Erro interno ao fazer login" });
  }
});

app.post("/clientes", async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha)
    return res
      .status(400)
      .json({ error: "Nome, email e senha são obrigatórios" });
  try {
    const senhaCriptografada = await bcrypt.hash(senha, 10);
    const sql = "INSERT INTO clientes (nome, email, senha) VALUES (?, ?, ?)";
    const [result] = await db.query(sql, [nome, email, senhaCriptografada]);

    // Envio de email para o admin sobre a nova solicitação
    await enviarEmail(email, nome);

    res
      .status(201)
      .json({
        message: "Solicitação de Cadastro Realizada!",
        id: result.insertId,
      });
  } catch (error) {
    console.error("Erro /clientes POST:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Este e-mail já está cadastrado." });
    }
    res.status(500).json({ error: "Erro ao solicitar cadastro" });
  }
});

// --- Rotas do Dashboard (Protegidas) ---
app.get(
  "/dashboard/status-usuarios",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const sql = `SELECT status, COUNT(*) as quantidade FROM clientes GROUP BY status`;
    try {
      const [results] = await db.query(sql);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: "Erro ao buscar dados de status." });
    }
  }
);

app.get(
  "/dashboard/cadastros-por-dia",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const { inicio, fim } = req.query;
    if (!inicio || !fim)
      return res
        .status(400)
        .json({ error: "Datas de início e fim são obrigatórias." });
    const sql = `SELECT DATE(created_at) as dia, COUNT(*) as quantidade FROM clientes WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY dia ASC`;
    try {
      const [results] = await db.query(sql, [inicio, fim]);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: "Erro ao buscar dados de cadastros." });
    }
  }
);

// --- Rotas de Clientes (Protegidas/Admin) ---
app.get("/clientes", verificarToken, verificarAdmin, async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT id, nome, email, foto_perfil, status, tipo FROM clientes where status = 'ativo'"
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar clientes" });
  }
});

app.get(
  "/clientesPendentes",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    try {
      const [results] = await db.query(
        "SELECT id, nome, email, foto_perfil, status, tipo FROM clientes where status = 'pendente'"
      );
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: "Erro ao buscar clientes pendentes" });
    }
  }
);

app.get("/clientes/:id", verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    const sql =
      "SELECT id, nome, email, foto_perfil, status, tipo FROM clientes WHERE id = ?";
    const [result] = await db.query(sql, [id]);
    if (result.length === 0)
      return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar cliente" });
  }
});

app.put("/clientes/:id", verificarToken, async (req, res) => {
  const { id } = req.params;
  const { nome, email, senha } = req.body;
  const usuarioLogado = req.user;

  if (usuarioLogado.tipo !== "admin" && usuarioLogado.id.toString() !== id) {
    return res.status(403).json({ error: "Acesso negado." });
  }
  if (!nome || !email)
    return res.status(400).json({ error: "Nome e email são obrigatórios." });

  try {
    let sql = "UPDATE clientes SET nome = ?, email = ?";
    const params = [nome, email];

    if (senha && senha.trim() !== "") {
      const senhaCriptografada = await bcrypt.hash(senha, 10);
      sql += ", senha = ?";
      params.push(senhaCriptografada);
    }

    sql += " WHERE id = ?";
    params.push(id);

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ message: "Perfil atualizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao processar a requisição." });
  }
});

app.delete(
  "/clientes/:id",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const sql = "DELETE FROM clientes WHERE id = ?";
      const [result] = await db.query(sql, [id]);
      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Cliente não encontrado" });
      res.json({ message: "Cliente excluído com sucesso!" });
    } catch (err) {
      res.status(500).json({ error: "Erro ao excluir cliente" });
    }
  }
);

app.put("/aprovarUsuario", verificarToken, verificarAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id)
    return res.status(400).json({ error: "ID do usuário é obrigatório" });
  try {
    // Busca o email ANTES de aprovar
    const [users] = await db.query("SELECT email FROM clientes WHERE id = ?", [
      id,
    ]);
    if (users.length === 0)
      return res.status(404).json({ error: "Usuário não encontrado" });

    const aprovarSql = "UPDATE clientes SET status = 'ativo' WHERE id = ?";
    await db.query(aprovarSql, [id]);

    // Envia o email de confirmação
    await enviarEmailConfirmacao(users[0].email);

    res.json({ message: "Usuário aprovado com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao aprovar usuário" });
  }
});

app.put(
  "/usuarios/:id/pendente",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const pendenteSql =
        "UPDATE clientes SET status = 'pendente' WHERE id = ?";
      const [result] = await db.query(pendenteSql, [id]);
      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Usuário não encontrado" });
      res.json({ message: "Usuário movido para pendente com sucesso!" });
    } catch (err) {
      res.status(500).json({ error: "Erro ao mover para pendente" });
    }
  }
);

// --- Rotas de Categorias ---
app.get("/categorias", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM categorias");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/categorias", verificarToken, verificarAdmin, async (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome)
    return res
      .status(400)
      .json({ error: "O nome da categoria é obrigatório." });
  try {
    const sql = `INSERT INTO categorias (nome, descricao) VALUES (?, ?)`;
    const [result] = await db.query(sql, [nome, descricao]);
    res
      .status(201)
      .json({ id: result.insertId, message: "Categoria criada com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/categorias/:id", verificarToken, verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const { nome, descricao } = req.body;
  try {
    const sql = `UPDATE categorias SET nome = ?, descricao = ? WHERE id = ?`;
    await db.query(sql, [nome, descricao, id]);
    res.json({ message: `Categoria ID ${id} atualizada.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(
  "/categorias/:id",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const sql = `DELETE FROM categorias WHERE id = ?`;
      await db.query(sql, [id]);
      res.json({ message: `Categoria ID ${id} deletada.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Rotas de Insetos e suas Imagens ---
app.get("/insetos", async (req, res) => {
  const sql = `
    SELECT i.*, GROUP_CONCAT(ii.url_imagem) as imagens 
    FROM insetos i
    LEFT JOIN imagens_inseto ii ON i.id = ii.id_inseto
    GROUP BY i.id`;
  try {
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/insetos/:id", verificarToken, verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const dados = req.body;
  try {
    const fields = Object.keys(dados).filter((key) => dados[key] !== undefined);
    const updates = fields.map((key) => `${key} = ?`);
    if (updates.length === 0)
      return res.status(400).json({ error: "Nenhum dado para atualizar" });

    const values = fields.map((key) => dados[key]);
    const sql = `UPDATE insetos SET ${updates.join(", ")} WHERE id = ?`;
    await db.query(sql, [...values, id]);
    res.json({ message: `Inseto ID ${id} atualizado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/insetos/:id", verificarToken, verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `DELETE FROM insetos WHERE id = ?`;
    await db.query(sql, [id]);
    res.json({ message: `Inseto ID ${id} deletado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/insetos/:id_inseto/imagens", async (req, res) => {
  const { id_inseto } = req.params;
  try {
    const sql = `SELECT * FROM imagens_inseto WHERE id_inseto = ?`;
    const [rows] = await db.query(sql, [id_inseto]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(
  "/insetos/imagens/:id_imagem",
  verificarToken,
  verificarAdmin,
  async (req, res) => {
    const { id_imagem } = req.params;
    try {
      const deleteSql = "DELETE FROM imagens_inseto WHERE id = ?";
      const [result] = await db.query(deleteSql, [id_imagem]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Imagem não encontrada." });
      }
      res
        .status(200)
        .json({ message: "Referência da imagem deletada com sucesso." });
    } catch (err) {
      res.status(500).json({ error: "Erro ao deletar imagem do banco." });
    }
  }
);

// --- MUDANÇA FINAL PARA VERCEL: Exportar o app ---
export default app;
