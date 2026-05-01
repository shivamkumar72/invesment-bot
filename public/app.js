const state = {
  token: localStorage.getItem('investment_token'),
  user: null,
  authMode: 'login',
};

const authForm = document.getElementById('auth-form');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const authMessage = document.getElementById('auth-message');
const authPanel = document.getElementById('auth-panel');
const authNameField = document.querySelector('.auth-name-field');
const authConfirmField = document.querySelector('.auth-confirm-field');
const authNameInput = document.getElementById('auth-name');
const authConfirmInput = document.getElementById('auth-confirm-password');
const userWelcome = document.getElementById('user-welcome');
const logoutButton = document.getElementById('logout-button');
const portfolioPanel = document.getElementById('portfolio-panel');
const chatPanel = document.getElementById('chat-panel');
const searchPanel = document.getElementById('search-panel');
const historyPanel = document.getElementById('history-panel');
const portfolioList = document.getElementById('portfolio-list');
const chatMessages = document.getElementById('chat-messages');
const searchForm = document.getElementById('search-form');
const historyContainer = document.getElementById('search-history');
const resultPanel = document.getElementById('result-panel');
const resultName = document.getElementById('result-name');
const resultSymbol = document.getElementById('result-symbol');
const resultAction = document.getElementById('result-action');
const resultPrice = document.getElementById('result-price');
const resultChange = document.getElementById('result-change');
const resultRange = document.getElementById('result-range');
const resultMarketcap = document.getElementById('result-marketcap');
const resultRisk = document.getElementById('result-risk');
const resultConfidence = document.getElementById('result-confidence');
const resultPredicted = document.getElementById('result-predicted');
const resultReason = document.getElementById('result-reason');
const sentimentSummary = document.getElementById('sentiment-summary');
const sentimentArticles = document.getElementById('sentiment-articles');
const chartCanvas = document.getElementById('stock-chart');
let stockChart = null;

function setAuthMode(mode) {
  state.authMode = mode;
  loginTab.classList.toggle('active', mode === 'login');
  signupTab.classList.toggle('active', mode === 'signup');
  authForm.querySelector('button').textContent = mode === 'login' ? 'Login' : 'Signup';
  authMessage.textContent = '';
}

function showMessage(target, message, type = 'info') {
  target.textContent = message;
  target.className = `form-message ${type}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    logout();
    throw new Error('Authentication required. Please sign in again.');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderUserPanel() {
  if (state.user) {
    userWelcome.textContent = `Signed in as ${state.user.name || state.user.email}`;
    logoutButton.classList.remove('hidden');
    portfolioPanel.classList.remove('hidden');
    chatPanel.classList.remove('hidden');
    searchPanel.classList.remove('hidden');
    historyPanel.classList.remove('hidden');
    authPanel.classList.add('hidden');
    loadPortfolio();
  } else {
    userWelcome.textContent = 'Not signed in';
    logoutButton.classList.add('hidden');
    portfolioPanel.classList.add('hidden');
    chatPanel.classList.add('hidden');
    searchPanel.classList.add('hidden');
    historyPanel.classList.add('hidden');
    authPanel.classList.remove('hidden');
    portfolioList.innerHTML = 'Sign in to view portfolio.';
  }
}

async function loadAuthState() {
  if (!state.token) {
    renderUserPanel();
    return;
  }

  try {
    const data = await apiFetch('/api/auth/me');
    state.user = data.user;
    renderUserPanel();
  } catch (error) {
    logout();
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('investment_token');
  renderUserPanel();
}

async function loadHistory() {
  try {
    const data = await apiFetch('/api/search-history', { method: 'GET' });
    const items = data.queries || [];
    if (!items.length) {
      historyContainer.innerHTML = '<p>No searches yet. Start with a ticker above.</p>';
      return;
    }

    historyContainer.innerHTML = items.map(item => `
      <div class="history-item">
        <div>${item.symbol}</div>
        <div>${new Date(item.lastSearched).toLocaleString()}</div>
      </div>
    `).join('');
  } catch (error) {
    historyContainer.innerHTML = '<p>Unable to load history.</p>';
  }
}

async function loadPortfolio() {
  try {
    const data = await apiFetch('/api/portfolio', { method: 'GET' });
    const items = data.portfolio || [];
    if (!items.length) {
      portfolioList.innerHTML = '<p>No positions yet. Add a holding above.</p>';
      return;
    }

    portfolioList.innerHTML = items.map(item => `
      <div class="portfolio-item">
        <div>
          <strong>${item.symbol}</strong>
          <div>${item.shares} shares at ${formatNumber(item.avgCost)}</div>
        </div>
        <button class="small-button" data-symbol="${item.symbol}">Remove</button>
      </div>
    `).join('');

    portfolioList.querySelectorAll('button[data-symbol]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await apiFetch('/api/portfolio/remove', {
            method: 'POST',
            body: JSON.stringify({ symbol: button.dataset.symbol }),
          });
          loadPortfolio();
          showMessage(authMessage, 'Position removed.', 'success');
        } catch (error) {
          showMessage(authMessage, error.message, 'error');
        }
      });
    });
  } catch (error) {
    portfolioList.innerHTML = '<p>Unable to load portfolio.</p>';
  }
}


function renderChart(data) {
  const labels = data.map(item => item.date);
  const values = data.map(item => item.close);

  if (stockChart) {
    stockChart.data.labels = labels;
    stockChart.data.datasets[0].data = values;
    stockChart.update();
    return;
  }

  stockChart = new Chart(chartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Close price',
        data: values,
        borderColor: '#49c5ff',
        backgroundColor: 'rgba(73, 197, 255, 0.16)',
        fill: true,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { color: '#c3d4e5' } },
      },
    },
  });
}

function renderResult(payload) {
  const { quote, history, recommendation, sentiment } = payload;

  resultName.textContent = quote.longName || quote.symbol;
  resultSymbol.textContent = quote.symbol;
  resultAction.textContent = recommendation.action;
  resultAction.className = `badge ${recommendation.action}`;
  resultPrice.textContent = `${quote.currency} ${formatNumber(quote.regularMarketPrice)}`;
  resultChange.textContent = `${formatNumber(quote.regularMarketChange)} (${formatNumber(quote.regularMarketChangePercent)}%)`;
  resultRange.textContent = `${formatNumber(quote.dayLow)} - ${formatNumber(quote.dayHigh)}`;
  resultMarketcap.textContent = quote.marketCap ? `${formatNumber(quote.marketCap)}` : 'N/A';
  resultRisk.textContent = recommendation.riskLevel;
  resultConfidence.textContent = `${recommendation.confidence}%`;
  resultPredicted.textContent = `${recommendation.predictedChange > 0 ? '+' : ''}${formatNumber(recommendation.predictedChange)}%`;
  resultReason.textContent = recommendation.reason;
  renderChart(history);

  sentimentSummary.textContent = sentiment.summary || 'No sentiment data available.';
  sentimentArticles.innerHTML = (sentiment.articles || []).map(article => `
    <div class="news-item">
      <a href="${article.url}" target="_blank">${article.title}</a>
      <p>Sentiment score: ${article.sentiment.score}</p>
    </div>
  `).join('');

  resultPanel.classList.remove('hidden');
}

async function handleSearch(event) {
  event.preventDefault();
  const symbol = document.getElementById('symbol').value.trim();
  const budget = document.getElementById('budget').value;
  const riskTolerance = document.getElementById('riskTolerance').value;

  if (!symbol) return;

  try {
    const data = await apiFetch('/api/search', {
      method: 'POST',
      body: JSON.stringify({ symbol, budget, riskTolerance }),
    });
    renderResult(data);
    loadHistory();
  } catch (error) {
    showMessage(authMessage, error.message, 'error');
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const name = authNameInput.value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const confirmPassword = authConfirmInput.value;
  const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

  if (state.authMode === 'signup') {
    if (!name) {
      showMessage(authMessage, 'Name is required for signup.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showMessage(authMessage, 'Passwords do not match.', 'error');
      return;
    }
  }

  try {
    const body = state.authMode === 'login'
      ? { email, password }
      : { name, email, password };

    const data = await apiFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    state.token = data.token;
    localStorage.setItem('investment_token', data.token);
    state.user = data.user;
    showMessage(authMessage, 'Signed in successfully.', 'success');
    renderUserPanel();
  } catch (error) {
    showMessage(authMessage, error.message, 'error');
  }
}

async function handlePortfolioSubmit(event) {
  event.preventDefault();
  const symbol = document.getElementById('portfolio-symbol').value.trim().toUpperCase();
  const shares = Number(document.getElementById('portfolio-shares').value);
  const avgCost = Number(document.getElementById('portfolio-cost').value);

  try {
    await apiFetch('/api/portfolio', {
      method: 'POST',
      body: JSON.stringify({ symbol, shares, avgCost }),
    });
    showMessage(authMessage, 'Position saved.', 'success');
    loadPortfolio();
  } catch (error) {
    showMessage(authMessage, error.message, 'error');
  }
}


function renderChatMessage(sender, text) {
  const entry = document.createElement('div');
  entry.className = `chat-entry ${sender}`;
  entry.textContent = text;
  chatMessages.appendChild(entry);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const questionInput = document.getElementById('chat-question');
  const question = questionInput.value.trim();
  if (!question) return;

  renderChatMessage('user', question);
  questionInput.value = '';

  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    renderChatMessage('bot', data.answer);
  } catch (error) {
    renderChatMessage('bot', `Error: ${error.message}`);
  }
}


loginTab.addEventListener('click', () => setAuthMode('login'));
signupTab.addEventListener('click', () => setAuthMode('signup'));
authForm.addEventListener('submit', handleAuthSubmit);
searchForm.addEventListener('submit', handleSearch);
logoutButton.addEventListener('click', logout);
document.getElementById('portfolio-form').addEventListener('submit', handlePortfolioSubmit);
document.getElementById('chat-form').addEventListener('submit', handleChatSubmit);

window.addEventListener('load', () => {
  setAuthMode('login');
  loadAuthState();
  loadHistory();
});
