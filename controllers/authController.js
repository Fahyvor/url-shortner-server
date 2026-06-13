const client = require("../config/googleClient");
const jwt = require("jsonwebtoken");
const prisma = require("../models/prismaClient");

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

    // 1. Exchange code for tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // 2. VERIFY ID TOKEN PROPERLY
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.redirect(`${process.env.BASE_URL}/auth-error`);
    }

    const {
      email,
      name,
      picture,
      email_verified,
      sub: googleId,
    } = payload;

    console.log("Payload", payload)

    if (!email || email_verified !== true) {
      return res.redirect(`${process.env.BASE_URL}/auth-error`);
    }

    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          picture,
        },
      });
    }

    const appToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        googleId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.redirect(
      `${process.env.BASE_URL}/success?token=${appToken}`
    );
  } catch (error) {
    console.error("Google OAuth error:", error);
    return res.redirect(`${process.env.BASE_URL}/auth-error`);
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany();

    return res.status(200).json({
      success: true,
      users,
    });

  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
};