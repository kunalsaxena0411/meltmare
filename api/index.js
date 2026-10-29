// Vercel entry point: runs the same server as a serverless function.
// Preview only: data is stored in /tmp and resets when the function restarts.
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/meltmare-data';
const { server } = require('../server');
module.exports = (req, res) => server.emit('request', req, res);
