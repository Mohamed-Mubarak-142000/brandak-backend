// Vercel serverless function: every request is rewritten here (see vercel.json).
// The app is compiled by `npm run build` (nest build resolves the @/ path aliases).
module.exports = require('../dist/serverless').default;
