const client = require("../config/googleClient");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

exports.googleRedirect = (req, res) => {
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    prompt: "consent",
  });

  res.redirect(url);
};

exports.googleCallback = async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.redirect(`${process.env.BASE_URL}/auth-error`);
    }

    const { tokens } = await client.getToken(code);

    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const { email, name, picture, email_verified } = payload;

    if (!email_verified) {
      return res.redirect(`${process.env.BASE_URL}/auth-error`);
    }

    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { email, name, picture },
      });
    }

    const appToken = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.redirect(
      `${process.env.BASE_URL}/success?token=${appToken}`
    );
  } catch (error) {
    console.error(error);
    res.redirect(`${process.env.BASE_URL}/auth-error`);
  }
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = prisma.user.get()
    } catch (error) {
        
    }
}