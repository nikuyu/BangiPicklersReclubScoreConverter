const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

function fetchURL(targetUrl) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https') ? https : http;
    const req = lib.get(targetUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function stripHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|h[1-6]|li|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ');
}

function parseScoresheet(html) {
  const text = stripHTML(html);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let title = 'Match Results', date = '';
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    if (lines[i].toUpperCase() === lines[i] && lines[i].length > 10 &&
        /CHALLENGE|LEAGUE|CUP|TOURNAMENT|TIER|WOMEN|MEN|OPEN/.test(lines[i])) {
      title = lines[i]; break;
    }
  }
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(lines[i])) {
      date = lines[i]; break;
    }
  }

  const matches = [];
  let round = null, court = null, i = 0;

  const isScore = v => { const n = parseInt(v); return !isNaN(n) && n >= 0 && n <= 30 && String(v).trim() === String(n); };
  const isName  = v => v.length > 0 && !isScore(v) && v !== 'Round' && !/^Court\s+\d+$/.test(v) &&
                       v !== 'Powered by Reclub' && v !== 'Print' && !/^Printable/.test(v) &&
                       !/^Note:/.test(v) && !/^This is/.test(v);

  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Round' && lines[i+1] && !isNaN(parseInt(lines[i+1]))) {
      round = parseInt(lines[i+1]); i += 2; continue;
    }
    if (/^Court\s+\d+$/.test(line)) { court = line; i++; continue; }
    if (round && court && i + 5 < lines.length) {
      const [t1a, t1b, s1, t2a, t2b, s2] = [lines[i],lines[i+1],lines[i+2],lines[i+3],lines[i+4],lines[i+5]];
      if (isName(t1a) && isName(t1b) && isScore(s1) && isName(t2a) && isName(t2b) && isScore(s2)) {
        matches.push({ round, court, t1a, t1b, s1: parseInt(s1), t2a, t2b, s2: parseInt(s2) });
        i += 6; continue;
      }
    }
    i++;
  }
  return { title, date, matches };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch(e) { res.writeHead(500); return res.end('index.html not found'); }
  }

  if (parsed.pathname === '/fetch') {
    const targetUrl = parsed.query.url;
    if (!targetUrl || !targetUrl.includes('reclub.co')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only reclub.co URLs allowed' }));
    }
    try {
      console.log('Fetching:', targetUrl);
      const html = await fetchURL(targetUrl);
      const data = parseScoresheet(html);
      console.log(`Parsed ${data.matches.length} matches from ${data.title}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch(e) {
      console.error('Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('\n  ⚡ Reclub Converter running!\n');
  console.log('  Open browser → http://localhost:' + PORT + '\n');
  console.log('  Press Ctrl+C to stop.\n');
});
