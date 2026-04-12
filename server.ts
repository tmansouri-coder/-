import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body } = req.body;
    
    // If SMTP is not configured, fallback to mock logging
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[MOCK EMAIL - NOT CONFIGURED] To: ${to}, Subject: ${subject}, Body: ${body}`);
      return res.json({ 
        success: true, 
        message: "Email logged to console (SMTP not configured in secrets)" 
      });
    }

    // Email Transporter Setup (recreated to pick up env changes)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    try {
      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Department Head'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
        to,
        subject,
        text: body,
        html: req.body.html || body,
      });
      console.log(`[EMAIL SENT] To: ${to}, Subject: ${subject}`);
      res.json({ success: true, message: "Email sent successfully" });
    } catch (error) {
      console.error("[EMAIL ERROR]", error);
      res.status(500).json({ success: false, message: "Failed to send email", error: String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
