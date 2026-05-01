require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const Sentiment = require('sentiment');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Invalid JSON received:', err.message);
    return res.status(400).json({ error: 'Invalid JSON body in request.' });
  }
  next(err);
});

const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_secure_secret';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

const sentiment = new Sentiment();

function ensureJsonFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

function readJson(filePath) {
  ensureJsonFile(filePath, { queries: [] });
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureHistoryFile() {
  ensureJsonFile(HISTORY_PATH, { queries: [] });
}

function ensureUsersFile() {
  ensureJsonFile(USERS_PATH, { users: [] });
}

function readHistory() {
  ensureHistoryFile();
  return readJson(HISTORY_PATH);
}

function readUsers() {
  ensureUsersFile();
  return readJson(USERS_PATH);
}

function saveHistory(symbol) {
  const current = readHistory();
  const existingIndex = current.queries.findIndex(item => item.symbol === symbol);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    current.queries[existingIndex].lastSearched = now;
    current.queries[existingIndex].count += 1;
  } else {
    current.queries.unshift({ symbol, lastSearched: now, count: 1 });
  }

  current.queries = current.queries
    .sort((a, b) => new Date(b.lastSearched) - new Date(a.lastSearched))
    .slice(0, 20);

  writeJson(HISTORY_PATH, current);
}

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
}

function getAuthorizationToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function authenticate(req, res, next) {
  const token = getAuthorizationToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function findUserByEmail(email) {
  const store = readUsers();
  return store.users.find(user => user.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
  const store = readUsers();
  return store.users.find(user => user.id === id);
}

function saveUser(user) {
  const store = readUsers();
  const existingIndex = store.users.findIndex(item => item.id === user.id);
  if (existingIndex >= 0) {
    store.users[existingIndex] = user;
  } else {
    store.users.push(user);
  }
  writeJson(USERS_PATH, store);
}


async function fetchNewsSentiment(symbol) {
  if (!NEWS_API_KEY) {
    return {
      enabled: false,
      score: 0,
      summary: 'News sentiment is disabled; add NEWS_API_KEY to .env.',
      articles: [],
    };
  }

  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: symbol,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 5,
      },
      headers: {
        'X-Api-Key': NEWS_API_KEY,
      },
    });

    const articles = (response.data.articles || []).map(item => ({
      title: item.title,
      description: item.description,
      url: item.url,
    }));

    const analyzed = articles.map(item => {
      const text = `${item.title} ${item.description || ''}`;
      return { ...item, sentiment: sentiment.analyze(text) };
    });

    if (analyzed.length === 0) {
      return {
        enabled: true,
        score: 0,
        summary: 'No news articles found for this symbol.',
        articles: [],
      };
    }

    const average = analyzed.reduce((sum, item) => sum + item.sentiment.score, 0) / analyzed.length;
    const summary = average > 1
      ? 'Overall news sentiment appears positive.'
      : average < -1
        ? 'Overall news sentiment appears negative.'
        : 'Overall news sentiment appears neutral.';

    return {
      enabled: true,
      score: Number(average.toFixed(2)),
      summary,
      articles: analyzed,
    };
  } catch (error) {
    console.error('News sentiment fetch error:', error.response ? error.response.data : error.message);
    return {
      enabled: false,
      score: 0,
      summary: 'Unable to fetch news sentiment at this time.',
      articles: [],
    };
  }
}

async function fetchQuote(symbol) {
  const quote = await yahooFinance.quote(symbol);
  if (quote && quote.regularMarketPrice != null && quote.currency) {
    return {
      symbol: quote.symbol,
      longName: quote.longName || quote.shortName || symbol,
      regularMarketPrice: quote.regularMarketPrice,
      regularMarketChange: quote.regularMarketChange,
      regularMarketChangePercent: quote.regularMarketChangePercent,
      regularMarketVolume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      currency: quote.currency,
      exchangeName: quote.fullExchangeName,
      previousClose: quote.regularMarketPreviousClose,
      open: quote.regularMarketOpen,
      dayHigh: quote.regularMarketDayHigh,
      dayLow: quote.regularMarketDayLow,
    };
  }

  if (!symbol.includes('.')) {
    const suffixes = ['.NS', '.BO'];
    for (const suffix of suffixes) {
      try {
        const altSymbol = `${symbol}${suffix}`;
        const altQuote = await yahooFinance.quote(altSymbol);
        if (altQuote && altQuote.regularMarketPrice != null && altQuote.currency) {
          return {
            symbol: altQuote.symbol,
            longName: altQuote.longName || altQuote.shortName || altSymbol,
            regularMarketPrice: altQuote.regularMarketPrice,
            regularMarketChange: altQuote.regularMarketChange,
            regularMarketChangePercent: altQuote.regularMarketChangePercent,
            regularMarketVolume: altQuote.regularMarketVolume,
            marketCap: altQuote.marketCap,
            currency: altQuote.currency,
            exchangeName: altQuote.fullExchangeName,
            previousClose: altQuote.regularMarketPreviousClose,
            open: altQuote.regularMarketOpen,
            dayHigh: altQuote.regularMarketDayHigh,
            dayLow: altQuote.regularMarketDayLow,
          };
        }
      } catch (err) {
        // ignore and continue trying other suffixes
      }
    }
  }

  throw new Error(`No valid quote returned for ${symbol}. For Indian tickers, try using exchange suffixes like .NS or .BO.`);
}

async function fetchHistory(symbol) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const queryChart = async (sym) => {
    const chart = await yahooFinance.chart(sym, {
      period1: startDate.toISOString().slice(0, 10),
      period2: endDate.toISOString().slice(0, 10),
      interval: '1d',
    });
    if (!chart || !Array.isArray(chart.quotes) || chart.quotes.length === 0) {
      return null;
    }
    return chart.quotes
      .filter(item => item.close != null)
      .map(item => ({
        date: new Date(item.date).toISOString().slice(0, 10),
        close: item.close,
      }));
  };

  let history = await queryChart(symbol);
  if (!history && !symbol.includes('.')) {
    const suffixes = ['.NS', '.BO'];
    for (const suffix of suffixes) {
      history = await queryChart(`${symbol}${suffix}`);
      if (history) break;
    }
  }

  if (!history || !history.length) {
    throw new Error(`Unable to fetch history for ${symbol}. Try using an exchange suffix like .NS or .BO for Indian stocks.`);
  }

  return history;
}

function analyzeTrend(priceHistory, riskTolerance) {
  const closes = priceHistory.map(item => item.close).filter(v => typeof v === 'number');
  if (closes.length < 5) {
    return {
      action: 'HOLD',
      predictedChange: 0,
      riskLevel: riskTolerance || 'medium',
      confidence: 55,
      reason: 'Not enough recent data to form a strong signal.',
    };
  }

  const first = closes[0];
  const last = closes[closes.length - 1];
  const changePct = ((last - first) / first) * 100;
  const riskLevel = riskTolerance || 'medium';

  let action = 'HOLD';
  if (changePct > 1.2) action = 'BUY';
  else if (changePct < -1.2) action = 'SELL';

  if (riskLevel === 'low' && action === 'BUY' && changePct < 2) action = 'HOLD';
  if (riskLevel === 'high' && action === 'SELL' && Math.abs(changePct) < 1.5) action = 'HOLD';

  const confidence = Math.min(95, Math.max(45, 55 + changePct * 0.8 - (riskLevel === 'high' ? 5 : 0)));
  const reason = action === 'BUY'
    ? 'Recent trend is positive and price momentum is upward.'
    : action === 'SELL'
      ? 'Recent trend is negative and momentum is weakening.'
      : 'Price movement is stable or not strong enough to change position.';

  return {
    action,
    predictedChange: Number(changePct.toFixed(2)),
    riskLevel,
    confidence: Math.round(confidence),
    reason,
  };
}

function buildPublicUser(user) {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email,
    portfolio: user.portfolio || [],
  };
}

function getUserFromRequest(req) {
  const token = getAuthorizationToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return findUserById(payload.userId);
  } catch {
    return null;
  }
}


app.post('/api/auth/register', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (findUserByEmail(email)) return res.status(400).json({ error: 'Email already registered.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `user_${Date.now()}`,
      name,
      email,
      passwordHash,
      portfolio: [],
      createdAt: new Date().toISOString(),
    };

    saveUser(user);
    const token = generateToken(user);
    res.json({ token, user: buildPublicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to register user.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = findUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Invalid credentials.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials.' });

    const token = generateToken(user);
    res.json({ token, user: buildPublicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to login.' });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = findUserById(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: buildPublicUser(user) });
});

app.get('/api/portfolio', authenticate, (req, res) => {
  const user = findUserById(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ portfolio: user.portfolio || [] });
});

app.post('/api/portfolio', authenticate, (req, res) => {
  try {
    const user = findUserById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const symbol = (req.body.symbol || '').toUpperCase().trim();
    const shares = Number(req.body.shares);
    const avgCost = Number(req.body.avgCost);
    if (!symbol || !shares || shares <= 0 || !avgCost || avgCost <= 0) {
      return res.status(400).json({ error: 'Symbol, shares, and average cost are required.' });
    }

    user.portfolio = user.portfolio || [];
    const existing = user.portfolio.find(item => item.symbol === symbol);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.avgCost = ((existing.shares * existing.avgCost) + (shares * avgCost)) / totalShares;
      existing.shares = totalShares;
    } else {
      user.portfolio.push({ symbol, shares, avgCost, addedAt: new Date().toISOString() });
    }

    saveUser(user);
    res.json({ portfolio: user.portfolio });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to save portfolio item.' });
  }
});

app.post('/api/portfolio/remove', authenticate, (req, res) => {
  const user = findUserById(req.auth.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const symbol = (req.body.symbol || '').toUpperCase().trim();
  user.portfolio = (user.portfolio || []).filter(item => item.symbol !== symbol);
  saveUser(user);
  res.json({ portfolio: user.portfolio });
});



app.post('/api/search', async (req, res) => {
  try {
    const symbol = (req.body.symbol || '').trim().toUpperCase();
    const riskTolerance = req.body.riskTolerance || 'medium';
    if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });

    const quote = await fetchQuote(symbol);
    const history = await fetchHistory(symbol);
    const recommendation = analyzeTrend(history.slice(-30), riskTolerance);
    const sentimentData = await fetchNewsSentiment(symbol);
    saveHistory(symbol);

    res.json({ symbol, quote, history: history.slice(-30), recommendation, sentiment: sentimentData });
  } catch (error) {
    console.error('Search error:', error?.message || error, error?.response?.data || '');
    res.status(500).json({ error: error.message || 'Unable to process search.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    const lower = question.toLowerCase();
    const symbolMatch = question.match(/\b([A-Z]{1,5})\b/);
    const symbol = (req.body.symbol || symbolMatch?.[1] || '').toUpperCase();
    const user = getUserFromRequest(req);

    if (symbol && /price|quote|cost|value/.test(lower)) {
      const quote = await fetchQuote(symbol);
      return res.json({ answer: `The current price of ${symbol} is ${quote.currency} ${quote.regularMarketPrice.toFixed(2)}. The daily range is ${quote.dayLow} - ${quote.dayHigh}.` });
    }

    if (symbol && /recommend|buy|sell|hold/.test(lower)) {
      const history = await fetchHistory(symbol);
      const recommendation = analyzeTrend(history.slice(-30), 'medium');
      return res.json({ answer: `For ${symbol}, the bot recommendation is ${recommendation.action} with ${recommendation.confidence}% confidence because ${recommendation.reason}` });
    }

    if (user && /portfolio|holdings|positions/.test(lower)) {
      const portfolio = user.portfolio || [];
      if (!portfolio.length) {
        return res.json({ answer: 'You do not have any portfolio holdings yet. Add positions through the portfolio panel.' });
      }
      const summary = portfolio.map(item => `${item.shares} shares of ${item.symbol} at an average cost of ${item.avgCost}`).join('; ');
      return res.json({ answer: `Your current portfolio positions are: ${summary}.` });
    }

    if (/help|how|what can you do/.test(lower)) {
      return res.json({ answer: 'I can provide stock quotes, buy/sell recommendations, portfolio summaries, and sentiment insights. Try asking: "What is AAPL price?" or "Should I buy MSFT?"' });
    }

    return res.json({ answer: 'I can help with stock price, recommendations, portfolio summaries, or sentiment analysis. Try asking about a ticker like AAPL.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to answer chat question.' });
  }
});



app.get('/api/search-history', (req, res) => {
  try {
    const history = readHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const BASE_PORT = Number(process.env.PORT) || 3000;
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Investment bot running at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is already in use. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

startServer(BASE_PORT);
