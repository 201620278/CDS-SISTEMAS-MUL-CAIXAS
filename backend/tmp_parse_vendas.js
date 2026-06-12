const fs = require('fs');
const acorn = require('acorn');
const path = require('path');
const file = path.join(__dirname, 'rotas', 'vendas.js');
const text = fs.readFileSync(file, 'utf8');
try {
  acorn.parse(text, { ecmaVersion: 2024, sourceType: 'script', locations: true });
  console.log('parsed ok');
} catch (err) {
  console.error('parse error:', err.message);
  if (err.loc) {
    console.error('line', err.loc.line, 'column', err.loc.column);
  }
  process.exit(1);
}
