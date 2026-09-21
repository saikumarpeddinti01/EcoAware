const jwt = require('jsonwebtoken');

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set in .env');
  return process.env.JWT_SECRET;
};

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, secret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const verifyToken = (token) => jwt.verify(token, secret());

module.exports = { signToken, verifyToken };
